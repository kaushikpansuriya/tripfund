import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minimumSettlement, EXACT_LIMIT, type BalanceEntry, type Payment } from '../src/index.ts';

function apply(balances: BalanceEntry[], payments: Payment[]) {
  const map = new Map(balances.map((b) => [b.memberId, b.net]));
  for (const p of payments) {
    map.set(p.from, map.get(p.from)! + p.amount);
    map.set(p.to, map.get(p.to)! - p.amount);
  }
  return map;
}

/** Brute force: n − (max number of disjoint zero-sum groups), via all partitions. */
function bruteForceMinimum(nets: number[]): number {
  const values = nets.filter((v) => v !== 0);
  const n = values.length;
  let bestGroups = 0;
  const assign = new Array<number>(n).fill(-1);
  function search(i: number, groups: number) {
    if (i === n) {
      const sums = new Array<number>(groups).fill(0);
      for (let k = 0; k < n; k++) sums[assign[k]] += values[k];
      if (sums.every((s) => s === 0)) bestGroups = Math.max(bestGroups, groups);
      return;
    }
    for (let g = 0; g <= groups; g++) {
      assign[i] = g;
      search(i + 1, Math.max(groups, g + 1));
    }
  }
  search(0, 0);
  return n === 0 ? 0 : n - bestGroups;
}

test('section 9 example: three debtors pay the one creditor', () => {
  const balances = [
    { memberId: 'john', net: 500000 },
    { memberId: 'david', net: -300000 },
    { memberId: 'alex', net: -150000 },
    { memberId: 'michael', net: -50000 },
  ];
  assert.deepEqual(minimumSettlement(balances), [
    { from: 'david', to: 'john', amount: 300000 },
    { from: 'alex', to: 'john', amount: 150000 },
    { from: 'michael', to: 'john', amount: 50000 },
  ]);
});

test('finds matching pairs that a simple greedy method would miss', () => {
  // Always matching the largest creditor with the largest debtor needs 5 payments here.
  // The optimum spots that B (+4) and D (−4) cancel out, and settles the rest
  // (+6, +6, −3, −9) in 3 payments → 4 in total.
  const balances = [
    { memberId: 'a', net: 6 },
    { memberId: 'b', net: 4 },
    { memberId: 'c', net: 6 },
    { memberId: 'd', net: -4 },
    { memberId: 'e', net: -3 },
    { memberId: 'f', net: -9 },
  ];
  const payments = minimumSettlement(balances);
  assert.equal(payments.length, 4);
  assert.ok(payments.some((p) => p.from === 'd' && p.to === 'b' && p.amount === 4));
  assert.ok([...apply(balances, payments).values()].every((v) => v === 0));
});

test('rejects balances that do not sum to zero', () => {
  assert.throws(() => minimumSettlement([{ memberId: 'a', net: 5 }, { memberId: 'b', net: -4 }]));
});

test('all settled → no payments', () => {
  assert.deepEqual(minimumSettlement([{ memberId: 'a', net: 0 }, { memberId: 'b', net: 0 }]), []);
});

test('matches brute-force optimum on random small groups', () => {
  let seed = 1234;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let run = 0; run < 300; run++) {
    const n = 2 + Math.floor(rand() * 6);
    // Small value range so zero-sum subgroups occur often.
    const nets = Array.from({ length: n - 1 }, () => Math.floor(rand() * 9) - 4);
    nets.push(-nets.reduce((a, b) => a + b, 0));
    const balances = nets.map((net, i) => ({ memberId: `m${i}`, net }));
    const payments = minimumSettlement(balances);
    assert.ok([...apply(balances, payments).values()].every((v) => v === 0), 'settles everything');
    assert.equal(payments.length, bruteForceMinimum(nets), `optimal for ${JSON.stringify(nets)}`);
    for (const p of payments) assert.ok(p.amount > 0);
  }
});

test('large groups fall back to greedy and still settle with at most n-1 payments', () => {
  const n = EXACT_LIMIT + 8;
  const nets = Array.from({ length: n - 1 }, (_, i) => (i % 2 === 0 ? 1 : -1) * (1000 + i * 37));
  nets.push(-nets.reduce((a, b) => a + b, 0));
  const balances = nets.map((net, i) => ({ memberId: `m${i}`, net }));
  const payments = minimumSettlement(balances);
  assert.ok([...apply(balances, payments).values()].every((v) => v === 0));
  assert.ok(payments.length <= n - 1);
});

test('exact search is fast at the limit', () => {
  const n = EXACT_LIMIT;
  const nets = Array.from({ length: n - 1 }, (_, i) => (i % 3 === 0 ? 3 : -1) * (100 + i));
  nets.push(-nets.reduce((a, b) => a + b, 0));
  const start = performance.now();
  minimumSettlement(nets.map((net, i) => ({ memberId: `m${i}`, net })));
  assert.ok(performance.now() - start < 2000, 'finishes within 2 seconds');
});
