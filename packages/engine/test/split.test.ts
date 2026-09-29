import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShares, SplitError, type ShareResult } from '../src/index.ts';

const sharesOf = (r: ShareResult[]) => Object.fromEntries(r.map((s) => [s.memberId, s.share]));
const sum = (r: ShareResult[]) => r.reduce((s, x) => s + x.share, 0);

test('equal split: ₹4,000 between 4 people is ₹1,000 each', () => {
  const r = computeShares(400000, 'equal', ['john', 'david', 'alex', 'michael'].map((memberId) => ({ memberId })));
  assert.deepEqual(sharesOf(r), { john: 100000, david: 100000, alex: 100000, michael: 100000 });
});

test('equal split rounding: ₹100 between 3 people → 33.34 + 33.33 + 33.33', () => {
  const r = computeShares(10000, 'equal', [{ memberId: 'a' }, { memberId: 'b' }, { memberId: 'c' }]);
  assert.deepEqual(r.map((s) => s.share), [3334, 3333, 3333]);
  assert.equal(sum(r), 10000);
});

test('equal split rounding: tiny amounts and many people still add up', () => {
  const people = Array.from({ length: 7 }, (_, i) => ({ memberId: `m${i}` }));
  const r = computeShares(5, 'equal', people);
  assert.equal(sum(r), 5);
  assert.deepEqual(r.map((s) => s.share), [1, 1, 1, 1, 1, 0, 0]);
});

test('exact split uses the given amounts', () => {
  const r = computeShares(400000, 'exact', [
    { memberId: 'john', value: 200000 },
    { memberId: 'david', value: 100000 },
    { memberId: 'alex', value: 50000 },
    { memberId: 'michael', value: 50000 },
  ]);
  assert.deepEqual(sharesOf(r), { john: 200000, david: 100000, alex: 50000, michael: 50000 });
});

test('exact split must add up to the expense amount', () => {
  assert.throws(
    () => computeShares(400000, 'exact', [{ memberId: 'a', value: 200000 }, { memberId: 'b', value: 100000 }]),
    (e: unknown) => e instanceof SplitError && e.code === 'EXACT_SUM_MISMATCH' && e.details.difference === 100000,
  );
});

test('exact split allows a zero share but not negative or fractional', () => {
  const r = computeShares(1000, 'exact', [{ memberId: 'a', value: 1000 }, { memberId: 'b', value: 0 }]);
  assert.equal(sum(r), 1000);
  assert.throws(() => computeShares(1000, 'exact', [{ memberId: 'a', value: 1100 }, { memberId: 'b', value: -100 }]), SplitError);
  assert.throws(() => computeShares(1000, 'exact', [{ memberId: 'a', value: 999.5 }, { memberId: 'b', value: 0.5 }]), SplitError);
});

test('percentage split: 50 / 25 / 15 / 10', () => {
  const r = computeShares(400000, 'percentage', [
    { memberId: 'john', value: 50 },
    { memberId: 'david', value: 25 },
    { memberId: 'alex', value: 15 },
    { memberId: 'michael', value: 10 },
  ]);
  assert.deepEqual(sharesOf(r), { john: 200000, david: 100000, alex: 60000, michael: 40000 });
});

test('percentage split with decimals rounds but keeps the exact total', () => {
  const r = computeShares(100001, 'percentage', [
    { memberId: 'a', value: 33.33 },
    { memberId: 'b', value: 33.33 },
    { memberId: 'c', value: 33.34 },
  ]);
  assert.equal(sum(r), 100001);
});

test('percentage split must total exactly 100%', () => {
  assert.throws(
    () => computeShares(1000, 'percentage', [{ memberId: 'a', value: 50 }, { memberId: 'b', value: 49.99 }]),
    (e: unknown) => e instanceof SplitError && e.code === 'PERCENT_SUM_MISMATCH',
  );
  assert.throws(() => computeShares(1000, 'percentage', [{ memberId: 'a', value: 100.001 }]), SplitError);
});

test('shares split: 2 / 1 / 1 shares of ₹4,000', () => {
  const r = computeShares(400000, 'shares', [
    { memberId: 'john', value: 2 },
    { memberId: 'david', value: 1 },
    { memberId: 'alex', value: 1 },
  ]);
  assert.deepEqual(sharesOf(r), { john: 200000, david: 100000, alex: 100000 });
});

test('shares split with fractional shares and rounding', () => {
  const r = computeShares(1000, 'shares', [
    { memberId: 'a', value: 1.5 },
    { memberId: 'b', value: 1 },
    { memberId: 'c', value: 1 },
  ]);
  assert.equal(sum(r), 1000);
  // 1000 × 1.5/3.5 = 428.57, 1000 × 1/3.5 = 285.71 (twice). The 2 leftover units
  // go to the two largest remainders (0.71, 0.71), not to the 0.57.
  assert.deepEqual(r.map((s) => s.share), [428, 286, 286]);
});

test('shares must be greater than zero', () => {
  assert.throws(() => computeShares(1000, 'shares', [{ memberId: 'a', value: 0 }]), SplitError);
  assert.throws(() => computeShares(1000, 'shares', [{ memberId: 'a', value: 1 }, { memberId: 'b', value: null }]), SplitError);
});

test('split validation: no participants, duplicates, bad amount, bad method', () => {
  assert.throws(() => computeShares(1000, 'equal', []), (e: unknown) => e instanceof SplitError && e.code === 'NO_PARTICIPANTS');
  assert.throws(
    () => computeShares(1000, 'equal', [{ memberId: 'a' }, { memberId: 'a' }]),
    (e: unknown) => e instanceof SplitError && e.code === 'DUPLICATE_PARTICIPANT',
  );
  assert.throws(() => computeShares(0, 'equal', [{ memberId: 'a' }]), (e: unknown) => e instanceof SplitError && e.code === 'INVALID_AMOUNT');
  assert.throws(() => computeShares(10.5, 'equal', [{ memberId: 'a' }]), SplitError);
  assert.throws(() => computeShares(1000, 'weird' as never, [{ memberId: 'a' }]), (e: unknown) => e instanceof SplitError && e.code === 'INVALID_METHOD');
});

test('splits are deterministic and always sum to the amount (randomised)', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let run = 0; run < 2000; run++) {
    const n = 1 + Math.floor(rand() * 9);
    const amount = 1 + Math.floor(rand() * 10_000_000);
    const people = Array.from({ length: n }, (_, i) => ({ memberId: `m${i}`, value: 1 + Math.floor(rand() * 400) / 100 }));
    const equal = computeShares(amount, 'equal', people);
    const shares = computeShares(amount, 'shares', people);
    assert.equal(sum(equal), amount);
    assert.equal(sum(shares), amount);
    assert.deepEqual(computeShares(amount, 'shares', people), shares);
    const max = Math.max(...equal.map((s) => s.share));
    const min = Math.min(...equal.map((s) => s.share));
    assert.ok(max - min <= 1, 'equal shares differ by at most one minor unit');
  }
});
