/**
 * Runs the calculation engine over all records of a trip (loaded by
 * tripQueries.ts). Dashboards, settlements and exports all use this, so every
 * screen shows the same numbers. No database access here: easy to test.
 */
import { computeLedger, type LedgerExpense, type LedgerResult } from '../../packages/engine/src/index.ts';
import {
  categoryJson,
  contributionJson,
  expenseJson,
  memberJson,
  settlementJson,
  type CategoryRow,
  type ContributionRow,
  type ExpenseRow,
  type MemberRow,
  type ParticipantRow,
  type SettlementRow,
  type TripRow,
} from './rows.ts';

export interface TripData {
  trip: TripRow;
  members: MemberRow[];
  categories: CategoryRow[];
  contributions: ContributionRow[];
  expenses: ExpenseRow[];
  participants: ParticipantRow[];
  settlements: SettlementRow[];
}

export function groupParticipants(participants: ParticipantRow[]): Map<string, ParticipantRow[]> {
  const map = new Map<string, ParticipantRow[]>();
  for (const p of participants) {
    const list = map.get(p.expense_id) ?? [];
    list.push(p);
    map.set(p.expense_id, list);
  }
  return map;
}

/** Stored split input → engine input. */
export function toLedgerExpense(e: ExpenseRow, participants: ParticipantRow[]): LedgerExpense {
  return {
    id: e.id,
    kind: e.kind,
    amount: e.amount,
    paidBy: e.paid_by_member_id,
    splitMethod: e.split_method,
    categoryId: e.category_id,
    date: e.spent_on,
    participants: participants
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ memberId: p.member_id, value: p.split_value })),
  };
}

export interface TripSummary {
  ledger: LedgerResult;
  /** True when the shares stored in the database equal a fresh calculation. */
  storedSharesMatch: boolean;
}

export function computeSummary(data: TripData): TripSummary {
  const byExpense = groupParticipants(data.participants);
  const ledger = computeLedger({
    members: data.members.map((m) => ({ id: m.id, name: m.name })),
    contributions: data.contributions.map((c) => ({
      id: c.id,
      memberId: c.member_id,
      receivedBy: c.received_by_member_id,
      amount: c.amount,
      date: c.contributed_on,
    })),
    expenses: data.expenses.map((e) => toLedgerExpense(e, byExpense.get(e.id) ?? [])),
    transfers: data.settlements.map((s) => ({ id: s.id, from: s.from_member_id, to: s.to_member_id, amount: s.amount, date: s.paid_on })),
  });

  let storedSharesMatch = true;
  for (const e of data.expenses) {
    const stored = new Map((byExpense.get(e.id) ?? []).map((p) => [p.member_id, p.share_amount]));
    for (const s of ledger.expenseShares[e.id] ?? []) {
      if (stored.get(s.memberId) !== s.share) storedSharesMatch = false;
    }
  }
  return { ledger, storedSharesMatch };
}

/** The full JSON for the trip overview: trip, members, balances, settlement plan, breakdowns. */
export function summaryJson(data: TripData, summary: TripSummary) {
  const { ledger } = summary;
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const memberName = new Map(data.members.map((m) => [m.id, m.name]));
  const memberInfo = new Map(data.members.map((m) => [m.id, m]));

  return {
    trip: {
      id: data.trip.id,
      name: data.trip.name,
      destination: data.trip.destination,
      startDate: data.trip.start_date,
      endDate: data.trip.end_date,
      currency: data.trip.currency,
      fundHolderMemberId: data.trip.fund_holder_member_id,
    },
    totals: {
      ...ledger.totals,
      expenseCount: data.expenses.filter((e) => e.kind === 'expense').length,
      refundCount: data.expenses.filter((e) => e.kind === 'refund').length,
      contributionCount: data.contributions.length,
      settlementCount: data.settlements.length,
    },
    members: ledger.members.map((b) => ({
      ...b,
      role: memberInfo.get(b.memberId)?.role ?? 'member',
      memberStatus: memberInfo.get(b.memberId)?.status ?? 'active',
    })),
    settlement: ledger.settlement.map((p) => ({
      fromMemberId: p.from,
      fromName: memberName.get(p.from) ?? '?',
      toMemberId: p.to,
      toName: memberName.get(p.to) ?? '?',
      amount: p.amount,
    })),
    byCategory: ledger.byCategory.map((c) => ({
      categoryId: c.key === 'uncategorized' ? null : c.key,
      name: categories.get(c.key)?.name ?? 'Uncategorised',
      icon: categories.get(c.key)?.icon ?? null,
      amount: c.amount,
    })),
    byDate: ledger.byDate.map((d) => ({ date: d.key, amount: d.amount })),
    paidByMember: ledger.paidByMember.map((p) => ({ memberId: p.key, name: memberName.get(p.key) ?? '?', amount: p.amount })),
    checks: { ...ledger.checks, storedSharesMatch: summary.storedSharesMatch },
  };
}

/** Everything in one object: used by exports and the future AI assistant. */
export function fullTripJson(data: TripData) {
  const byExpense = groupParticipants(data.participants);
  return {
    members: data.members.map(memberJson),
    categories: data.categories.map(categoryJson),
    contributions: data.contributions.map(contributionJson),
    expenses: data.expenses.map((e) => expenseJson(e, byExpense.get(e.id) ?? [])),
    settlements: data.settlements.map(settlementJson),
  };
}
