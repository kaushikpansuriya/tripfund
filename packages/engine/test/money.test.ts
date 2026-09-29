import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, toDecimalString, formatMoney, isValidAmount } from '../src/index.ts';

test('parseMoney converts typed amounts to integer minor units', () => {
  assert.equal(parseMoney('4000'), 400000);
  assert.equal(parseMoney('1,234.50'), 123450);
  assert.equal(parseMoney('1234.5'), 123450);
  assert.equal(parseMoney('0.01'), 1);
  assert.equal(parseMoney(' 12 000 '), 1200000);
  assert.equal(parseMoney('12.'), 1200);
  assert.equal(parseMoney(15000), 1500000);
});

test('parseMoney never uses floating point (0.1 + 0.2 style bugs)', () => {
  assert.equal(parseMoney('0.29'), 29);
  assert.equal(parseMoney('1.15'), 115);
  assert.equal(parseMoney('4.35'), 435);
  assert.equal(parseMoney('999999999.99'), 99999999999);
});

test('parseMoney rejects invalid input', () => {
  for (const bad of ['', 'abc', '-5', '1.234', '1e3', '12,34.5.6', '₹100', '.']) {
    assert.equal(parseMoney(bad), null, `should reject "${bad}"`);
  }
});

test('toDecimalString is the exact inverse of parseMoney', () => {
  assert.equal(toDecimalString(123450), '1234.50');
  assert.equal(toDecimalString(1), '0.01');
  assert.equal(toDecimalString(-5000), '-50.00');
  for (const v of [0, 5, 99, 100, 123456789]) assert.equal(parseMoney(toDecimalString(v)), v);
});

test('formatMoney shows currency and sign', () => {
  assert.equal(formatMoney(5000000, 'INR'), '₹50,000.00');
  assert.equal(formatMoney(5000000, 'INR', { hideZeroDecimals: true }), '₹50,000');
  assert.equal(formatMoney(550000, 'INR', { signed: true, hideZeroDecimals: true }), '+₹5,500');
  assert.equal(formatMoney(-300000, 'INR', { hideZeroDecimals: true }), '-₹3,000');
  assert.equal(formatMoney(1999, 'USD'), '$19.99');
});

test('isValidAmount accepts only positive safe integers', () => {
  assert.ok(isValidAmount(1));
  assert.ok(!isValidAmount(0));
  assert.ok(!isValidAmount(-1));
  assert.ok(!isValidAmount(1.5));
  assert.ok(!isValidAmount(Number.NaN));
  assert.ok(!isValidAmount('100' as unknown as number));
});
