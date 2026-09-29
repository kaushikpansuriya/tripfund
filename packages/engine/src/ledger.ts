/**
 * Trip ledger: the complete financial picture of one trip.
 *
 * Money model ("own money"):
 *  - A CONTRIBUTION is money one member hands to another member (usually the
 *    trip's fund holder) for the trip. The giver is owed that money; the
 *    receiver holds it and owes it back. If a member records a contribution to
 *    themselves it has no effect on balances (they still hold their own money),
 *    but it still counts towards "total money added".
 *  - An EXPENSE is always paid with the payer's own money (which may be fund
 *    money they are holding). The payer is owed the amount; every participant
 *    owes their share.
 *  - A REFUND is money received back (e.g. a cancelled booking). The member
 *    who received it owes it; every participant gets their share back.
 *  - A TRANSFER is a direct payment between two members (settlement payments,
 *    money returned from the fund, loans).
 *
 * Net balance per member (positive = should receive, negative = should pay):
 *
 *   net = contributed − fundHeld
 *       + paid − refundsReceived
 *       − expenseShare + refundShare
 *       + transfersSent − transfersReceived
 *
 * Every record adds and subtracts the same amount, so the nets of all
 * members always sum to exactly zero. Nothing is counted twice.
 */
import { computeShares, type ShareResult, type SplitMethod, type SplitParticipant } from './split.ts';
import { minimumSettlement, type Payment } from './settlement.ts';
import { isValidAmount } from './money.ts';

export interface LedgerMember {
  id: string;
  name: string;
}

export interface LedgerContribution {
  id: string;
  memberId: string;
  /** Member who received/holds the money. Null/undefined = the giver keeps it. */
  receivedBy?: string | null;
  amount: number;
  date?: string | null;
}

export type ExpenseKind = 'expense' | 'refund';

export interface LedgerExpense {
  id: string;
  kind?: ExpenseKind;
  amount: number;
  /** Expense: member who paid. Refund: member who received the refund. */
  paidBy: string;
  splitMethod: SplitMethod;
  participants: SplitParticipant[];
  categoryId?: string | null;
  date?: string | null;
}

export interface LedgerTransfer {
  id: string;
  from: string;
  to: string;
  amount: number;
  date?: string | null;
}

export interface LedgerInput {
  members: LedgerMember[];
  contributions: LedgerContribution[];
  expenses: LedgerExpense[];
  transfers: LedgerTransfer[];
}

export interface MemberBalance {
  memberId: string;
  name: string;
  contributed: number;
  fundHeld: number;
  paid: number;
  refundsReceived: number;
  expenseShare: number;
  refundShare: number;
  /** Personal share of trip spending: expenseShare − refundShare. */
  share: number;
  transfersSent: number;
  transfersReceived: number;
  net: number;
  status: 'receive' | 'pay' | 'settled';
}

export interface LedgerTotals {
  memberCount: number;
  contributions: number;
  expensesGross: number;
  refunds: number;
  /** Total trip spending: expenses − refunds. */
  expenses: number;
  /** Money added − net spending. What is left of the fund after everyone is reimbursed. */
  fundRemaining: number;
  transfers: number;
  totalToReceive: number;
  totalOwed: number;
}

export interface LedgerChecks {
  balancesSumToZero: boolean;
  sharesMatchExpenses: boolean;
  settlementClearsBalances: boolean;
}

export interface AmountByKey {
  key: string;
  amount: number;
}

export interface LedgerResult {
  totals: LedgerTotals;
  members: MemberBalance[];
  expenseShares: Record<string, ShareResult[]>;
  settlement: Payment[];
  byCategory: AmountByKey[];
  byDate: AmountByKey[];
  paidByMember: AmountByKey[];
  checks: LedgerChecks;
}

export class LedgerError extends Error {
  code: 'UNKNOWN_MEMBER' | 'INVALID_AMOUNT' | 'SAME_MEMBER' | 'INVARIANT';
  recordId: string | null;

  constructor(code: LedgerError['code'], message: string, recordId: string | null = null) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.recordId = recordId;
  }
}

function addTo(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sortedEntries(map: Map<string, number>, by: 'amount' | 'key'): AmountByKey[] {
  const list = [...map.entries()].map(([key, amount]) => ({ key, amount }));
  return by === 'amount'
    ? list.sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key))
    : list.sort((a, b) => a.key.localeCompare(b.key));
}

export function computeLedger(input: LedgerInput): LedgerResult {
  const byId = new Map<string, MemberBalance>();
  for (const m of input.members) {
    byId.set(m.id, {
      memberId: m.id,
      name: m.name,
      contributed: 0,
      fundHeld: 0,
      paid: 0,
      refundsReceived: 0,
      expenseShare: 0,
      refundShare: 0,
      share: 0,
      transfersSent: 0,
      transfersReceived: 0,
      net: 0,
      status: 'settled',
    });
  }
  const member = (id: string | null | undefined, recordId: string): MemberBalance => {
    const found = id ? byId.get(id) : undefined;
    if (!found) throw new LedgerError('UNKNOWN_MEMBER', `Record ${recordId} refers to an unknown member (${String(id)}).`, recordId);
    return found;
  };
  const amountOf = (amount: number, recordId: string): number => {
    if (!isValidAmount(amount)) throw new LedgerError('INVALID_AMOUNT', `Record ${recordId} has an invalid amount.`, recordId);
    return amount;
  };

  const totals: LedgerTotals = {
    memberCount: input.members.length,
    contributions: 0,
    expensesGross: 0,
    refunds: 0,
    expenses: 0,
    fundRemaining: 0,
    transfers: 0,
    totalToReceive: 0,
    totalOwed: 0,
  };

  // Contributions
  for (const c of input.contributions) {
    const amount = amountOf(c.amount, c.id);
    const giver = member(c.memberId, c.id);
    const holder = c.receivedBy ? member(c.receivedBy, c.id) : giver;
    giver.contributed += amount;
    holder.fundHeld += amount;
    totals.contributions += amount;
  }

  // Expenses and refunds
  const expenseShares: Record<string, ShareResult[]> = {};
  const byCategory = new Map<string, number>();
  const byDate = new Map<string, number>();
  const paidByMember = new Map<string, number>();
  let sharesMatch = true;

  for (const e of input.expenses) {
    const amount = amountOf(e.amount, e.id);
    const payer = member(e.paidBy, e.id);
    for (const p of e.participants) member(p.memberId, e.id);
    const shares = computeShares(amount, e.splitMethod, e.participants);
    expenseShares[e.id] = shares;
    if (shares.reduce((s, r) => s + r.share, 0) !== amount) sharesMatch = false;

    const sign = e.kind === 'refund' ? -1 : 1;
    if (sign > 0) {
      payer.paid += amount;
      totals.expensesGross += amount;
      addTo(paidByMember, payer.memberId, amount);
      for (const s of shares) byId.get(s.memberId)!.expenseShare += s.share;
    } else {
      payer.refundsReceived += amount;
      totals.refunds += amount;
      addTo(paidByMember, payer.memberId, -amount);
      for (const s of shares) byId.get(s.memberId)!.refundShare += s.share;
    }
    addTo(byCategory, e.categoryId ?? 'uncategorized', sign * amount);
    if (e.date) addTo(byDate, e.date, sign * amount);
  }

  // Transfers
  for (const t of input.transfers) {
    const amount = amountOf(t.amount, t.id);
    if (t.from === t.to) throw new LedgerError('SAME_MEMBER', `Transfer ${t.id} has the same sender and receiver.`, t.id);
    member(t.from, t.id).transfersSent += amount;
    member(t.to, t.id).transfersReceived += amount;
    totals.transfers += amount;
  }

  // Balances
  const members = [...byId.values()];
  for (const m of members) {
    m.share = m.expenseShare - m.refundShare;
    m.net =
      m.contributed - m.fundHeld + m.paid - m.refundsReceived - m.expenseShare + m.refundShare + m.transfersSent - m.transfersReceived;
    m.status = m.net > 0 ? 'receive' : m.net < 0 ? 'pay' : 'settled';
    if (m.net > 0) totals.totalToReceive += m.net;
    if (m.net < 0) totals.totalOwed += -m.net;
  }

  totals.expenses = totals.expensesGross - totals.refunds;
  totals.fundRemaining = totals.contributions - totals.expenses;

  const netSum = members.reduce((s, m) => s + m.net, 0);
  if (netSum !== 0) {
    throw new LedgerError('INVARIANT', `Balances do not sum to zero (${netSum}). This should never happen.`);
  }

  const settlement = minimumSettlement(members.map((m) => ({ memberId: m.memberId, net: m.net })));

  // Verify: applying the settlement must bring every balance to zero.
  const after = new Map(members.map((m) => [m.memberId, m.net]));
  for (const p of settlement) {
    after.set(p.from, (after.get(p.from) ?? 0) + p.amount);
    after.set(p.to, (after.get(p.to) ?? 0) - p.amount);
  }
  const settlementClears = [...after.values()].every((v) => v === 0);

  return {
    totals,
    members,
    expenseShares,
    settlement,
    byCategory: sortedEntries(byCategory, 'amount'),
    byDate: sortedEntries(byDate, 'key'),
    paidByMember: sortedEntries(paidByMember, 'amount'),
    checks: {
      balancesSumToZero: netSum === 0,
      sharesMatchExpenses: sharesMatch,
      settlementClearsBalances: settlementClears,
    },
  };
}
