/**
 * Server unit tests that need no database: request validation, the report
 * model and CSV export.   Run: node --test test/unit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contributionSchema, createTripSchema, expenseFilterSchema, expenseSchema, settlementSchema, updateTripSchema } from '../src/validation.ts';
import { computeSummary, type TripData } from '../src/tripData.ts';
import { buildReport } from '../src/exports/report.ts';
import { renderCsv } from '../src/exports/csv.ts';
import type { ExpenseRow, MemberRow, ParticipantRow, TripRow } from '../src/rows.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('expense validation accepts a normal expense and applies defaults', () => {
  const parsed = expenseSchema.parse({
    title: '  Hotel ',
    amount: 1200000,
    paidByMemberId: id(1),
    splitMethod: 'equal',
    participants: [{ memberId: id(1) }, { memberId: id(2) }],
  });
  assert.equal(parsed.title, 'Hotel');
  assert.equal(parsed.kind, 'expense');
  assert.equal(parsed.location, undefined);
});

test('expense validation rejects bad input', () => {
  const base = { title: 'X', amount: 100, paidByMemberId: id(1), splitMethod: 'equal', participants: [{ memberId: id(1) }] };
  assert.throws(() => expenseSchema.parse({ ...base, amount: 10.5 }));
  assert.throws(() => expenseSchema.parse({ ...base, amount: -1 }));
  assert.throws(() => expenseSchema.parse({ ...base, amount: '100' }));
  assert.throws(() => expenseSchema.parse({ ...base, splitMethod: 'random' }));
  assert.throws(() => expenseSchema.parse({ ...base, participants: [] }));
  assert.throws(() => expenseSchema.parse({ ...base, paidByMemberId: 'not-a-uuid' }));
  assert.throws(() => expenseSchema.parse({ ...base, date: '2026-02-30' }));
  assert.throws(() => expenseSchema.parse({ ...base, time: '25:00' }));
  assert.throws(() => expenseSchema.parse({ ...base, title: '   ' }));
});

test('optional text: empty clears the field, missing leaves it unchanged', () => {
  const cleared = updateTripSchema.parse({ destination: '' });
  assert.equal(cleared.destination, null);
  const untouched = updateTripSchema.parse({ name: 'Goa' });
  assert.equal(untouched.destination, undefined);
});

test('trip validation', () => {
  const trip = createTripSchema.parse({ name: 'Goa Trip 2026', members: [{ name: 'David' }, { name: 'Alex', email: 'ALEX@Example.com ' }] });
  assert.equal(trip.currency, 'INR');
  assert.equal(trip.members[1].email, 'alex@example.com');
  assert.throws(() => createTripSchema.parse({ name: 'X', startDate: '2026-09-10', endDate: '2026-09-01' }));
  assert.throws(() => createTripSchema.parse({ name: 'X', currency: 'XYZ' }));
});

test('contribution, settlement and filter validation', () => {
  assert.equal(contributionSchema.parse({ memberId: id(1), amount: 100 }).paymentMethod, 'cash');
  assert.throws(() => contributionSchema.parse({ memberId: id(1), amount: 100, paymentMethod: 'bitcoin' }));
  assert.throws(() => settlementSchema.parse({ fromMemberId: id(1), toMemberId: id(1), amount: 100 }));
  const f = expenseFilterSchema.parse({ q: 'taxi' });
  assert.equal(f.sort, 'date_desc');
  assert.equal(f.memberRole, 'any');
});

// ---------------------------------------------------------------------------
// Report + CSV, using the specification's section 22 trip
// ---------------------------------------------------------------------------
function sampleTrip(): TripData {
  const now = new Date('2026-09-10T10:00:00Z');
  const trip: TripRow = {
    id: id(100),
    created_by: id(900),
    name: 'Goa Trip 2026',
    destination: 'Goa',
    description: null,
    start_date: '2026-09-10',
    end_date: '2026-09-14',
    currency: 'INR',
    fund_holder_member_id: id(1),
    member_edit_policy: 'own',
    created_at: now,
    updated_at: now,
  };
  const names = ['John', 'David', 'Alex', 'Sarah'];
  const members: MemberRow[] = names.map((name, i) => ({
    id: id(i + 1),
    trip_id: trip.id,
    user_id: i === 0 ? id(900) : null,
    name,
    email: null,
    role: i === 0 ? 'owner' : 'member',
    status: 'active',
    joined_on: null,
    left_on: null,
    created_at: now,
  }));
  const expense = (n: number, title: string, amount: number, payer: number, who: number[]): [ExpenseRow, ParticipantRow[]] => [
    {
      id: id(200 + n),
      trip_id: trip.id,
      kind: 'expense',
      title,
      category_id: null,
      amount,
      paid_by_member_id: id(payer),
      split_method: 'equal',
      spent_on: '2026-09-1' + n,
      spent_at: null,
      location: null,
      notes: n === 1 ? 'Sea view, "deluxe"' : null,
      created_by: id(900),
      created_at: now,
      updated_at: now,
    },
    who.map((m, position) => ({ expense_id: id(200 + n), member_id: id(m), split_value: null, share_amount: 0, position })),
  ];
  const list = [
    expense(1, 'Hotel', 800000, 1, [1, 2, 3, 4]),
    expense(2, 'Food', 400000, 2, [1, 2, 3, 4]),
    expense(3, 'Taxi', 200000, 3, [1, 2, 3]),
    expense(4, '=Activity', 300000, 4, [4, 1]),
  ];
  return {
    trip,
    members,
    categories: [],
    contributions: [1, 2, 3, 4].map((m) => ({
      id: id(300 + m),
      trip_id: trip.id,
      member_id: id(m),
      received_by_member_id: id(1),
      amount: m === 1 ? 1000000 : 500000,
      contributed_on: '2026-09-10',
      payment_method: 'upi',
      notes: null,
      created_by: id(900),
      created_at: now,
      updated_at: now,
    })),
    expenses: list.map(([e]) => e),
    participants: list.flatMap(([, p]) => p),
    settlements: [],
  };
}

test('report numbers come from the engine', () => {
  const data = sampleTrip();
  const summary = computeSummary(data);
  // Shares were stored as 0 in this fixture, so the check must flag them.
  assert.equal(summary.storedSharesMatch, false);
  const report = buildReport(data, summary);
  const overview = Object.fromEntries(report.overview.map(([label, value]) => [label, value]));
  assert.equal(overview['Total money added'], 2500000);
  assert.equal(overview['Net spending'], 1700000);
  assert.equal(overview['Remaining (money added − spending)'], 800000);
  const settlement = report.tables.find((t) => t.id === 'settlement')!;
  assert.equal(settlement.rows.length, 3);
  assert.ok(settlement.rows.every((r) => r.from === 'John'));
  const history = report.tables.find((t) => t.id === 'history')!;
  assert.equal(history.rows.length, 8);
});

test('CSV export: decimals, escaping and formula protection', () => {
  const data = sampleTrip();
  const report = buildReport(data, computeSummary(data));
  const csv = renderCsv(report, 'expenses');
  assert.ok(csv.startsWith('﻿'), 'has UTF-8 BOM for Excel');
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0].replace('﻿', ''), 'Date,Expense,Category,Paid by,Split,Amount (INR)');
  assert.ok(lines.some((l) => l.includes(",Hotel,") && l.endsWith(',8000.00')));
  assert.ok(lines.some((l) => l.includes("'=Activity")), 'formula-like text is neutralised');
  assert.ok(lines[lines.length - 1].endsWith(',17000.00'), 'total row');
  const all = renderCsv(report, 'all');
  for (const title of ['Contributions', 'Expenses', 'Member summary', 'Final settlement', 'Transaction history']) {
    assert.ok(all.includes(`\r\n${title}\r\n`), `section ${title}`);
  }
});
