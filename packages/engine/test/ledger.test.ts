import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLedger, LedgerError, type LedgerInput, type LedgerResult } from '../src/index.ts';

const R = (rupees: number) => Math.round(rupees * 100); // ₹ → paise

function members(...names: string[]) {
  return names.map((name) => ({ id: name.toLowerCase(), name }));
}

function balance(result: LedgerResult, id: string) {
  const m = result.members.find((x) => x.memberId === id);
  assert.ok(m, `member ${id} missing`);
  return m;
}

/** Invariants that must hold for every trip. */
function assertInvariants(input: LedgerInput, result: LedgerResult) {
  assert.equal(result.members.reduce((s, m) => s + m.net, 0), 0, 'nets sum to zero');
  assert.ok(result.checks.balancesSumToZero);
  assert.ok(result.checks.sharesMatchExpenses);
  assert.ok(result.checks.settlementClearsBalances);
  for (const e of input.expenses) {
    assert.equal(result.expenseShares[e.id].reduce((s, x) => s + x.share, 0), e.amount, `shares of ${e.id} equal its amount`);
  }
  const shareSum = result.members.reduce((s, m) => s + m.share, 0);
  assert.equal(shareSum, result.totals.expenses, 'personal shares add up to total spending');
  assert.equal(result.totals.totalOwed, result.totals.totalToReceive, 'total owed equals total to receive');
  const open = result.members.filter((m) => m.net !== 0).length;
  assert.ok(result.settlement.length <= Math.max(0, open - 1), 'settlement uses at most n-1 payments');
  for (const p of result.settlement) assert.ok(p.amount > 0 && p.from !== p.to);
}

// ---------------------------------------------------------------------------
// Section 22 of the specification. Nothing about the result is hard-coded in
// the engine; the expected values below are worked out independently here.
// ---------------------------------------------------------------------------
test('specification example (section 22)', () => {
  const input: LedgerInput = {
    members: members('John', 'David', 'Alex', 'Sarah'),
    // John is the fund holder: everyone hands their contribution to John.
    contributions: [
      { id: 'c1', memberId: 'john', receivedBy: 'john', amount: R(10000) },
      { id: 'c2', memberId: 'david', receivedBy: 'john', amount: R(5000) },
      { id: 'c3', memberId: 'alex', receivedBy: 'john', amount: R(5000) },
      { id: 'c4', memberId: 'sarah', receivedBy: 'john', amount: R(5000) },
    ],
    expenses: [
      { id: 'hotel', amount: R(8000), paidBy: 'john', splitMethod: 'equal', participants: [{ memberId: 'john' }, { memberId: 'david' }, { memberId: 'alex' }, { memberId: 'sarah' }] },
      { id: 'food', amount: R(4000), paidBy: 'david', splitMethod: 'equal', participants: [{ memberId: 'john' }, { memberId: 'david' }, { memberId: 'alex' }, { memberId: 'sarah' }] },
      { id: 'taxi', amount: R(2000), paidBy: 'alex', splitMethod: 'equal', participants: [{ memberId: 'john' }, { memberId: 'david' }, { memberId: 'alex' }] },
      { id: 'activity', amount: R(3000), paidBy: 'sarah', splitMethod: 'equal', participants: [{ memberId: 'sarah' }, { memberId: 'john' }] },
    ],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);

  // 1-3. Totals
  assert.equal(r.totals.contributions, R(25000));
  assert.equal(r.totals.expenses, R(17000));
  assert.equal(r.totals.fundRemaining, R(8000));

  // 4. Shares. Taxi: 200000 paise / 3 = 66667 + 66667 + 66666 (first two in the list get the extra paisa)
  const taxi = Object.fromEntries(r.expenseShares.taxi.map((s) => [s.memberId, s.share]));
  assert.deepEqual(taxi, { john: 66667, david: 66667, alex: 66666 });
  assert.equal(balance(r, 'john').share, R(2000) + R(1000) + 66667 + R(1500));
  assert.equal(balance(r, 'david').share, R(2000) + R(1000) + 66667);
  assert.equal(balance(r, 'alex').share, R(2000) + R(1000) + 66666);
  assert.equal(balance(r, 'sarah').share, R(2000) + R(1000) + R(1500));

  // 5. Actual payments
  assert.equal(balance(r, 'john').paid, R(8000));
  assert.equal(balance(r, 'david').paid, R(4000));
  assert.equal(balance(r, 'alex').paid, R(2000));
  assert.equal(balance(r, 'sarah').paid, R(3000));

  // 6. Net balances: contributed − held + paid − share
  const net = (id: string, contributed: number, held: number) => contributed - held + balance(r, id).paid - balance(r, id).share;
  assert.equal(balance(r, 'john').net, net('john', R(10000), R(25000)));
  assert.equal(balance(r, 'david').net, net('david', R(5000), 0));
  assert.equal(balance(r, 'alex').net, net('alex', R(5000), 0));
  assert.equal(balance(r, 'sarah').net, net('sarah', R(5000), 0));

  // 7-8. John holds everyone's money, so he pays; the others receive.
  assert.equal(balance(r, 'john').status, 'pay');
  assert.equal(balance(r, 'david').status, 'receive');
  assert.equal(balance(r, 'alex').status, 'receive');
  assert.equal(balance(r, 'sarah').status, 'receive');

  // 9. Minimum settlement: 3 payments, all from John.
  assert.equal(r.settlement.length, 3);
  for (const p of r.settlement) {
    assert.equal(p.from, 'john');
    assert.equal(p.amount, balance(r, p.to).net);
  }
});

test('section 22 again without a fund holder (everyone keeps their own contribution)', () => {
  const input: LedgerInput = {
    members: members('John', 'David', 'Alex', 'Sarah'),
    contributions: [
      { id: 'c1', memberId: 'john', amount: R(10000) },
      { id: 'c2', memberId: 'david', amount: R(5000) },
      { id: 'c3', memberId: 'alex', amount: R(5000) },
      { id: 'c4', memberId: 'sarah', amount: R(5000) },
    ],
    expenses: [
      { id: 'hotel', amount: R(8000), paidBy: 'john', splitMethod: 'equal', participants: members('John', 'David', 'Alex', 'Sarah').map((m) => ({ memberId: m.id })) },
      { id: 'food', amount: R(4000), paidBy: 'david', splitMethod: 'equal', participants: members('John', 'David', 'Alex', 'Sarah').map((m) => ({ memberId: m.id })) },
      { id: 'taxi', amount: R(2000), paidBy: 'alex', splitMethod: 'equal', participants: members('John', 'David', 'Alex').map((m) => ({ memberId: m.id })) },
      { id: 'activity', amount: R(3000), paidBy: 'sarah', splitMethod: 'equal', participants: members('Sarah', 'John').map((m) => ({ memberId: m.id })) },
    ],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  // Contributions kept by the giver change nothing: net = paid − share.
  for (const m of r.members) {
    assert.equal(m.net, m.paid - m.share);
  }
  assert.equal(r.totals.contributions, R(25000));
  assert.equal(r.totals.fundRemaining, R(8000));
});

test('section 6: John pays ₹4,000 shared by 4 → John should receive ₹3,000', () => {
  const input: LedgerInput = {
    members: members('John', 'David', 'Alex', 'Michael'),
    contributions: [],
    expenses: [{ id: 'dinner', amount: R(4000), paidBy: 'john', splitMethod: 'equal', participants: members('John', 'David', 'Alex', 'Michael').map((m) => ({ memberId: m.id })) }],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  assert.equal(balance(r, 'john').share, R(1000));
  assert.equal(balance(r, 'john').net, R(3000));
  for (const id of ['david', 'alex', 'michael']) assert.equal(balance(r, id).net, -R(1000));
  assert.deepEqual(
    r.settlement.map((p) => [p.from, p.to, p.amount]),
    [
      ['david', 'john', R(1000)],
      ['alex', 'john', R(1000)],
      ['michael', 'john', R(1000)],
    ],
  );
});

test('custom and percentage splits inside a ledger', () => {
  const input: LedgerInput = {
    members: members('John', 'David', 'Alex', 'Michael'),
    contributions: [],
    expenses: [
      { id: 'e1', amount: R(4000), paidBy: 'david', splitMethod: 'exact', participants: [{ memberId: 'john', value: R(2000) }, { memberId: 'david', value: R(1000) }, { memberId: 'alex', value: R(500) }, { memberId: 'michael', value: R(500) }] },
      { id: 'e2', amount: R(4000), paidBy: 'john', splitMethod: 'percentage', participants: [{ memberId: 'john', value: 50 }, { memberId: 'david', value: 25 }, { memberId: 'alex', value: 15 }, { memberId: 'michael', value: 10 }] },
      { id: 'e3', amount: R(4000), paidBy: 'alex', splitMethod: 'shares', participants: [{ memberId: 'john', value: 2 }, { memberId: 'david', value: 1 }, { memberId: 'alex', value: 1 }] },
    ],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  assert.equal(balance(r, 'john').share, R(2000) + R(2000) + R(2000));
  assert.equal(balance(r, 'michael').share, R(500) + R(400));
  assert.equal(balance(r, 'michael').net, -R(900));
});

test('multiple contributors to one fund holder, holder pays expenses from the fund', () => {
  // Sarah holds the fund; she pays everything from it.
  const input: LedgerInput = {
    members: members('John', 'David', 'Sarah'),
    contributions: [
      { id: 'c1', memberId: 'john', receivedBy: 'sarah', amount: R(3000) },
      { id: 'c2', memberId: 'david', receivedBy: 'sarah', amount: R(3000) },
      { id: 'c3', memberId: 'sarah', receivedBy: 'sarah', amount: R(3000) },
    ],
    expenses: [{ id: 'e1', amount: R(9000), paidBy: 'sarah', splitMethod: 'equal', participants: members('John', 'David', 'Sarah').map((m) => ({ memberId: m.id })) }],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  // Everyone put in exactly their share and the fund is used up: all settled.
  assert.equal(r.totals.fundRemaining, 0);
  for (const m of r.members) assert.equal(m.net, 0);
  assert.equal(r.settlement.length, 0);
  assert.equal(balance(r, 'sarah').fundHeld, R(9000));
});

test('unspent fund money is returned through the settlement', () => {
  const input: LedgerInput = {
    members: members('John', 'David'),
    contributions: [
      { id: 'c1', memberId: 'john', receivedBy: 'john', amount: R(5000) },
      { id: 'c2', memberId: 'david', receivedBy: 'john', amount: R(5000) },
    ],
    expenses: [{ id: 'e1', amount: R(6000), paidBy: 'john', splitMethod: 'equal', participants: members('John', 'David').map((m) => ({ memberId: m.id })) }],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  assert.equal(r.totals.fundRemaining, R(4000));
  // David put in 5,000 and his share is 3,000 → John returns 2,000.
  assert.deepEqual(r.settlement, [{ from: 'john', to: 'david', amount: R(2000) }]);
});

test('members joining later only share the expenses they took part in', () => {
  const input: LedgerInput = {
    members: members('John', 'David', 'Late'),
    contributions: [],
    expenses: [
      { id: 'day1', amount: R(1000), paidBy: 'john', splitMethod: 'equal', participants: members('John', 'David').map((m) => ({ memberId: m.id })), date: '2026-09-10' },
      { id: 'day3', amount: R(3000), paidBy: 'david', splitMethod: 'equal', participants: members('John', 'David', 'Late').map((m) => ({ memberId: m.id })), date: '2026-09-12' },
    ],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  assert.equal(balance(r, 'late').share, R(1000));
  assert.equal(balance(r, 'late').net, -R(1000));
  assert.deepEqual(r.byDate, [
    { key: '2026-09-10', amount: R(1000) },
    { key: '2026-09-12', amount: R(3000) },
  ]);
});

test('members leaving keep their balance until it is settled', () => {
  const base: LedgerInput = {
    members: members('John', 'David', 'Leaver'),
    contributions: [],
    expenses: [{ id: 'e1', amount: R(3000), paidBy: 'leaver', splitMethod: 'equal', participants: members('John', 'David', 'Leaver').map((m) => ({ memberId: m.id })) }],
    transfers: [],
  };
  const before = computeLedger(base);
  assertInvariants(base, before);
  assert.equal(balance(before, 'leaver').net, R(2000));
  // The leaver is paid back before going home.
  const after: LedgerInput = {
    ...base,
    transfers: [
      { id: 't1', from: 'john', to: 'leaver', amount: R(1000) },
      { id: 't2', from: 'david', to: 'leaver', amount: R(1000) },
    ],
  };
  const r = computeLedger(after);
  assertInvariants(after, r);
  for (const m of r.members) assert.equal(m.net, 0);
  assert.equal(r.settlement.length, 0);
});

test('partial settlement (section 11): David owes John ₹3,000, pays ₹2,000, then owes ₹1,000', () => {
  const input: LedgerInput = {
    members: members('John', 'David'),
    contributions: [],
    expenses: [{ id: 'e1', amount: R(3000), paidBy: 'john', splitMethod: 'exact', participants: [{ memberId: 'david', value: R(3000) }] }],
    transfers: [],
  };
  const before = computeLedger(input);
  assert.deepEqual(before.settlement, [{ from: 'david', to: 'john', amount: R(3000) }]);

  const withPayment = { ...input, transfers: [{ id: 't1', from: 'david', to: 'john', amount: R(2000) }] };
  const after = computeLedger(withPayment);
  assertInvariants(withPayment, after);
  assert.deepEqual(after.settlement, [{ from: 'david', to: 'john', amount: R(1000) }]);
  assert.equal(balance(after, 'david').transfersSent, R(2000));
  assert.equal(balance(after, 'john').transfersReceived, R(2000));
});

test('overpaying flips the direction of the debt', () => {
  const input: LedgerInput = {
    members: members('John', 'David'),
    contributions: [],
    expenses: [{ id: 'e1', amount: R(1000), paidBy: 'john', splitMethod: 'exact', participants: [{ memberId: 'david', value: R(1000) }] }],
    transfers: [{ id: 't1', from: 'david', to: 'john', amount: R(1500) }],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  assert.deepEqual(r.settlement, [{ from: 'john', to: 'david', amount: R(500) }]);
});

test('refunds reduce spending and are shared back', () => {
  const input: LedgerInput = {
    members: members('John', 'David'),
    contributions: [],
    expenses: [
      { id: 'hotel', amount: R(6000), paidBy: 'john', splitMethod: 'equal', participants: members('John', 'David').map((m) => ({ memberId: m.id })), categoryId: 'hotel' },
      // One night cancelled: the hotel refunds ₹2,000 to John.
      { id: 'refund', kind: 'refund', amount: R(2000), paidBy: 'john', splitMethod: 'equal', participants: members('John', 'David').map((m) => ({ memberId: m.id })), categoryId: 'hotel' },
    ],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  assert.equal(r.totals.expensesGross, R(6000));
  assert.equal(r.totals.refunds, R(2000));
  assert.equal(r.totals.expenses, R(4000));
  assert.equal(balance(r, 'david').share, R(2000));
  assert.equal(balance(r, 'john').net, R(2000));
  assert.deepEqual(r.byCategory, [{ key: 'hotel', amount: R(4000) }]);
});

test('zero balances: everyone paid exactly their share', () => {
  const input: LedgerInput = {
    members: members('A', 'B'),
    contributions: [],
    expenses: [
      { id: 'e1', amount: R(500), paidBy: 'a', splitMethod: 'equal', participants: members('A', 'B').map((m) => ({ memberId: m.id })) },
      { id: 'e2', amount: R(500), paidBy: 'b', splitMethod: 'equal', participants: members('A', 'B').map((m) => ({ memberId: m.id })) },
    ],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  assert.ok(r.members.every((m) => m.net === 0 && m.status === 'settled'));
  assert.deepEqual(r.settlement, []);
  assert.equal(r.totals.totalOwed, 0);
});

test('empty trip', () => {
  const input: LedgerInput = { members: members('Solo'), contributions: [], expenses: [], transfers: [] };
  const r = computeLedger(input);
  assertInvariants(input, r);
  assert.equal(r.totals.expenses, 0);
  assert.deepEqual(r.settlement, []);
});

test('rounding differences never leak: 3 × ₹100 split three ways', () => {
  const people = members('A', 'B', 'C').map((m) => ({ memberId: m.id }));
  const input: LedgerInput = {
    members: members('A', 'B', 'C'),
    contributions: [],
    expenses: [
      { id: 'e1', amount: R(100), paidBy: 'a', splitMethod: 'equal', participants: people },
      { id: 'e2', amount: R(100), paidBy: 'b', splitMethod: 'equal', participants: people },
      { id: 'e3', amount: R(100), paidBy: 'c', splitMethod: 'equal', participants: people },
    ],
    transfers: [],
  };
  const r = computeLedger(input);
  assertInvariants(input, r);
  // A gets the extra paisa on every split (first in the list): 3334 × 3 = 10002.
  assert.equal(balance(r, 'a').share, 10002);
  assert.equal(r.members.reduce((s, m) => s + m.share, 0), R(300));
});

test('ledger rejects records that point to unknown members or bad amounts', () => {
  const base: LedgerInput = { members: members('A', 'B'), contributions: [], expenses: [], transfers: [] };
  assert.throws(() => computeLedger({ ...base, contributions: [{ id: 'x', memberId: 'zzz', amount: 100 }] }), (e: unknown) => e instanceof LedgerError && e.code === 'UNKNOWN_MEMBER');
  assert.throws(() => computeLedger({ ...base, transfers: [{ id: 'x', from: 'a', to: 'a', amount: 100 }] }), (e: unknown) => e instanceof LedgerError && e.code === 'SAME_MEMBER');
  assert.throws(() => computeLedger({ ...base, transfers: [{ id: 'x', from: 'a', to: 'b', amount: -5 }] }), (e: unknown) => e instanceof LedgerError && e.code === 'INVALID_AMOUNT');
  assert.throws(
    () => computeLedger({ ...base, expenses: [{ id: 'x', amount: 100, paidBy: 'a', splitMethod: 'equal', participants: [{ memberId: 'ghost' }] }] }),
    (e: unknown) => e instanceof LedgerError && e.code === 'UNKNOWN_MEMBER',
  );
});

test('the same input always produces the same output', () => {
  const input: LedgerInput = {
    members: members('A', 'B', 'C', 'D'),
    contributions: [{ id: 'c', memberId: 'a', receivedBy: 'b', amount: 777 }],
    expenses: [{ id: 'e', amount: 1001, paidBy: 'c', splitMethod: 'equal', participants: members('A', 'B', 'C', 'D').map((m) => ({ memberId: m.id })) }],
    transfers: [{ id: 't', from: 'd', to: 'a', amount: 3 }],
  };
  assert.deepEqual(computeLedger(input), computeLedger(structuredClone(input)));
});

test('randomised trips keep every invariant', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  for (let run = 0; run < 400; run++) {
    const ms = members(...Array.from({ length: 2 + Math.floor(rand() * 8) }, (_, i) => `M${i}`));
    const ids = ms.map((m) => m.id);
    const input: LedgerInput = { members: ms, contributions: [], expenses: [], transfers: [] };
    for (let i = 0; i < Math.floor(rand() * 5); i++) {
      input.contributions.push({ id: `c${i}`, memberId: pick(ids), receivedBy: rand() < 0.7 ? ids[0] : null, amount: 1 + Math.floor(rand() * 1_000_000) });
    }
    for (let i = 0; i < 1 + Math.floor(rand() * 12); i++) {
      const participants = ids.filter(() => rand() < 0.7);
      if (participants.length === 0) participants.push(pick(ids));
      input.expenses.push({
        id: `e${i}`,
        kind: rand() < 0.1 ? 'refund' : 'expense',
        amount: 1 + Math.floor(rand() * 500_000),
        paidBy: pick(ids),
        splitMethod: 'shares',
        participants: participants.map((memberId) => ({ memberId, value: 1 + Math.floor(rand() * 3) })),
      });
    }
    for (let i = 0; i < Math.floor(rand() * 3); i++) {
      const from = pick(ids);
      const to = pick(ids.filter((x) => x !== from));
      input.transfers.push({ id: `t${i}`, from, to, amount: 1 + Math.floor(rand() * 100_000) });
    }
    assertInvariants(input, computeLedger(input));
  }
});
