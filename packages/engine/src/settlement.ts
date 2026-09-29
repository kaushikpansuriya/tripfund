/**
 * Settlement: turn member balances into the fewest possible payments.
 *
 * The minimum number of payments for n people with non-zero balances is
 *   n − (maximum number of groups the balances can be split into, where each
 *        group sums to zero)
 * because a zero-sum group of k people can always be settled in k − 1
 * payments and never in fewer.
 *
 * For up to EXACT_LIMIT people with a non-zero balance the engine finds that
 * maximum exactly (dynamic programming over subsets, O(2^n · n)). Above the
 * limit it falls back to the greedy largest-debtor → largest-creditor method,
 * which always needs at most n − 1 payments.
 */

export interface BalanceEntry {
  memberId: string;
  /** Positive = should receive money, negative = should pay. Minor units. */
  net: number;
}

export interface Payment {
  from: string;
  to: string;
  amount: number;
}

export const EXACT_LIMIT = 16;

interface Party {
  memberId: string;
  amount: number;
  order: number;
}

/** Settle one group whose balances sum to zero. Needs at most (size − 1) payments. */
function settleGroup(entries: BalanceEntry[], order: Map<string, number>): Payment[] {
  const sortParties = (a: Party, b: Party) => b.amount - a.amount || a.order - b.order;
  const creditors: Party[] = [];
  const debtors: Party[] = [];
  for (const e of entries) {
    const party = { memberId: e.memberId, amount: Math.abs(e.net), order: order.get(e.memberId) ?? 0 };
    if (e.net > 0) creditors.push(party);
    else if (e.net < 0) debtors.push(party);
  }
  const payments: Payment[] = [];
  creditors.sort(sortParties);
  debtors.sort(sortParties);
  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = creditors[0];
    const debtor = debtors[0];
    const amount = Math.min(creditor.amount, debtor.amount);
    payments.push({ from: debtor.memberId, to: creditor.memberId, amount });
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditors.shift();
    if (debtor.amount === 0) debtors.shift();
    creditors.sort(sortParties);
    debtors.sort(sortParties);
  }
  return payments;
}

/** Split entries into the maximum number of zero-sum groups (exact, small n). */
function maxZeroSumGroups(entries: BalanceEntry[]): BalanceEntry[][] {
  const n = entries.length;
  const size = 1 << n;
  const sums = new Float64Array(size);
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    const bit = 31 - Math.clz32(low);
    sums[mask] = sums[mask ^ low] + entries[bit].net;
  }
  // best[mask] = max number of completed zero-sum groups when the members in
  // `mask` are placed one after another in the best possible order.
  const best = new Int16Array(size);
  for (let mask = 1; mask < size; mask++) {
    let value = -1;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        const v = best[mask ^ (1 << i)];
        if (v > value) value = v;
      }
    }
    best[mask] = value + (sums[mask] === 0 ? 1 : 0);
  }

  // Rebuild an order that reaches the optimum, then cut it where the running sum is zero.
  const orderIdx: number[] = [];
  let mask = size - 1;
  while (mask) {
    const bonus = sums[mask] === 0 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i) && best[mask ^ (1 << i)] + bonus === best[mask]) {
        orderIdx.push(i);
        mask ^= 1 << i;
        break;
      }
    }
  }
  orderIdx.reverse();

  const groups: BalanceEntry[][] = [];
  let current: BalanceEntry[] = [];
  let running = 0;
  for (const i of orderIdx) {
    current.push(entries[i]);
    running += entries[i].net;
    if (running === 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function minimumSettlement(balances: BalanceEntry[]): Payment[] {
  const total = balances.reduce((sum, b) => sum + b.net, 0);
  if (total !== 0) {
    throw new Error(`Balances must sum to zero before settling (sum is ${total}).`);
  }
  const order = new Map(balances.map((b, i) => [b.memberId, i]));
  const open = balances.filter((b) => b.net !== 0);
  if (open.length === 0) return [];

  if (open.length > EXACT_LIMIT) return settleGroup(open, order);

  const payments: Payment[] = [];
  for (const group of maxZeroSumGroups(open)) {
    payments.push(...settleGroup(group, order));
  }
  return payments;
}
