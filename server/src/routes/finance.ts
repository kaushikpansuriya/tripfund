/**
 * Money records of a trip: contributions, expenses (with splits), settlement
 * payments, and the computed summary.
 */
import { Router, type Request } from 'express';
import { computeShares } from '../../../packages/engine/src/index.ts';
import { access, assertCanModify, canModify, type TripAccess } from '../access.ts';
import { audit, money, notifyTrip } from '../activity.ts';
import { many, one, pool, SQL, tx, type Db } from '../db.ts';
import { badRequest, forbidden, notFound } from '../http.ts';
import {
  contributionJson,
  expenseJson,
  settlementJson,
  type ContributionRow,
  type ExpenseRow,
  type MemberRow,
  type ParticipantRow,
  type SettlementRow,
} from '../rows.ts';
import { computeSummary, groupParticipants, summaryJson } from '../tripData.ts';
import { loadTripData } from '../tripQueries.ts';
import { contributionSchema, expenseFilterSchema, expenseSchema, settlementSchema, uuid } from '../validation.ts';

export const financeRouter = Router({ mergeParams: true });

const today = () => new Date().toISOString().slice(0, 10);

async function tripMembers(db: Db, tripId: string): Promise<Map<string, MemberRow>> {
  const rows = await many<MemberRow>(db, SQL`SELECT * FROM trip_members WHERE trip_id = $1`, [tripId]);
  return new Map(rows.map((m) => [m.id, m]));
}

function requireMember(members: Map<string, MemberRow>, id: string, label: string): MemberRow {
  const m = members.get(id);
  if (!m) throw badRequest(`${label} is not a member of this trip.`);
  return m;
}

const withPermission = <T extends { createdBy: string | null }>(a: TripAccess, item: T) => ({ ...item, canEdit: canModify(a, item.createdBy) });

// ===========================================================================
// Summary
// ===========================================================================

financeRouter.get('/summary', async (req, res) => {
  const a = access(req);
  const data = await loadTripData(a.trip);
  res.json(summaryJson(data, computeSummary(data)));
});

// ===========================================================================
// Contributions
// ===========================================================================

financeRouter.get('/contributions', async (req, res) => {
  const a = access(req);
  const rows = await many<ContributionRow>(
    pool,
    SQL`SELECT * FROM contributions WHERE trip_id = $1 ORDER BY contributed_on DESC, created_at DESC`,
    [a.trip.id],
  );
  res.json({ contributions: rows.map((r) => withPermission(a, contributionJson(r))) });
});

async function contributionValues(req: Request, a: TripAccess) {
  const input = contributionSchema.parse(req.body);
  const members = await tripMembers(pool, a.trip.id);
  const giver = requireMember(members, input.memberId, 'The contributor');
  const receiverId = input.receivedByMemberId ?? a.trip.fund_holder_member_id ?? input.memberId;
  const receiver = requireMember(members, receiverId, 'The receiver');
  return { input, giver, receiver };
}

financeRouter.post('/contributions', async (req, res) => {
  const a = access(req);
  const { input, giver, receiver } = await contributionValues(req, a);
  const row = await tx(async (db) => {
    const created = await one<ContributionRow>(
      db,
      SQL`INSERT INTO contributions (trip_id, member_id, received_by_member_id, amount, contributed_on, payment_method, notes, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [a.trip.id, giver.id, receiver.id, input.amount, input.date ?? today(), input.paymentMethod, input.notes ?? null, req.user!.id],
    );
    await audit(db, req, { tripId: a.trip.id, action: 'create', entityType: 'contribution', entityId: created!.id, after: created });
    await notifyTrip(db, req, a.trip.id, 'contribution_added', `${giver.name} added ${money(input.amount, a.trip.currency)} to the trip fund.`, {
      contributionId: created!.id,
    });
    return created!;
  });
  res.status(201).json({ contribution: withPermission(a, contributionJson(row)) });
});

financeRouter.patch('/contributions/:id', async (req, res) => {
  const a = access(req);
  const id = uuid.parse(req.params.id);
  const before = await one<ContributionRow>(pool, SQL`SELECT * FROM contributions WHERE trip_id = $1 AND id = $2`, [a.trip.id, id]);
  if (!before) throw notFound('Contribution not found.');
  assertCanModify(a, before.created_by);
  const { input, giver, receiver } = await contributionValues(req, a);
  const row = await tx(async (db) => {
    const updated = await one<ContributionRow>(
      db,
      SQL`UPDATE contributions SET member_id = $3, received_by_member_id = $4, amount = $5, contributed_on = $6,
            payment_method = $7, notes = $8, updated_at = now()
          WHERE trip_id = $1 AND id = $2 RETURNING *`,
      [a.trip.id, id, giver.id, receiver.id, input.amount, input.date ?? before.contributed_on, input.paymentMethod, input.notes ?? null],
    );
    await audit(db, req, { tripId: a.trip.id, action: 'update', entityType: 'contribution', entityId: id, before, after: updated });
    return updated!;
  });
  res.json({ contribution: withPermission(a, contributionJson(row)) });
});

financeRouter.delete('/contributions/:id', async (req, res) => {
  const a = access(req);
  const id = uuid.parse(req.params.id);
  const before = await one<ContributionRow>(pool, SQL`SELECT * FROM contributions WHERE trip_id = $1 AND id = $2`, [a.trip.id, id]);
  if (!before) throw notFound('Contribution not found.');
  assertCanModify(a, before.created_by);
  await tx(async (db) => {
    await db.query(SQL`DELETE FROM contributions WHERE trip_id = $1 AND id = $2`, [a.trip.id, id]);
    await audit(db, req, { tripId: a.trip.id, action: 'delete', entityType: 'contribution', entityId: id, before });
  });
  res.status(204).end();
});

// ===========================================================================
// Expenses
// ===========================================================================

async function loadExpense(db: Db, tripId: string, id: string) {
  const expense = await one<ExpenseRow>(db, SQL`SELECT * FROM expenses WHERE trip_id = $1 AND id = $2`, [tripId, id]);
  if (!expense) return null;
  const participants = await many<ParticipantRow>(
    db,
    SQL`SELECT expense_id, member_id, split_value, share_amount, position FROM expense_participants WHERE expense_id = $1 ORDER BY position`,
    [id],
  );
  return { expense, participants };
}

/** Validate an expense body: members, category, and the split (computed by the engine). */
async function expenseValues(req: Request, a: TripAccess) {
  const input = expenseSchema.parse(req.body);
  const members = await tripMembers(pool, a.trip.id);
  const payer = requireMember(members, input.paidByMemberId, input.kind === 'refund' ? 'The refund receiver' : 'The payer');
  for (const p of input.participants) requireMember(members, p.memberId, 'A selected participant');

  if (input.categoryId) {
    const category = await one(pool, SQL`SELECT id FROM expense_categories WHERE id = $1 AND (trip_id IS NULL OR trip_id = $2)`, [
      input.categoryId,
      a.trip.id,
    ]);
    if (!category) throw badRequest('Unknown category.');
  }

  // Throws SplitError (→ 422) when the split does not add up.
  const shares = computeShares(input.amount, input.splitMethod, input.participants);
  const participants = input.participants.map((p, position) => ({
    memberId: p.memberId,
    value: input.splitMethod === 'equal' ? null : (p.value ?? null),
    share: shares[position].share,
    position,
  }));
  return { input, payer, participants };
}

async function writeParticipants(db: Db, tripId: string, expenseId: string, participants: { memberId: string; value: number | null; share: number; position: number }[]) {
  await db.query(SQL`DELETE FROM expense_participants WHERE expense_id = $1`, [expenseId]);
  await db.query(
    SQL`INSERT INTO expense_participants (trip_id, expense_id, member_id, split_value, share_amount, position)
        SELECT $1, $2, x.member_id, x.split_value, x.share_amount, x.position
        FROM unnest($3::uuid[], $4::numeric[], $5::bigint[], $6::smallint[]) AS x(member_id, split_value, share_amount, position)`,
    [
      tripId,
      expenseId,
      participants.map((p) => p.memberId),
      participants.map((p) => p.value),
      participants.map((p) => p.share),
      participants.map((p) => p.position),
    ],
  );
}

financeRouter.get('/expenses', async (req, res) => {
  const a = access(req);
  const f = expenseFilterSchema.parse(req.query);

  const orderBy = {
    date_desc: SQL`e.spent_on DESC, e.spent_at DESC NULLS LAST, e.created_at DESC`,
    date_asc: SQL`e.spent_on ASC, e.spent_at ASC NULLS FIRST, e.created_at ASC`,
    amount_desc: SQL`e.amount DESC, e.spent_on DESC`,
    amount_asc: SQL`e.amount ASC, e.spent_on DESC`,
  }[f.sort];

  // All filters are parameters; a NULL parameter switches its filter off.
  const rows = await many<ExpenseRow>(
    pool,
    SQL`SELECT e.* FROM expenses e
        WHERE e.trip_id = $1
          AND ($2::text IS NULL OR e.title ILIKE $2 OR e.location ILIKE $2 OR e.notes ILIKE $2)
          AND ($3::uuid IS NULL
               OR ($4 IN ('any', 'paid') AND e.paid_by_member_id = $3)
               OR ($4 IN ('any', 'shared') AND EXISTS (
                     SELECT 1 FROM expense_participants p WHERE p.expense_id = e.id AND p.member_id = $3)))
          AND ($5::uuid IS NULL OR e.category_id = $5)
          AND ($6::date IS NULL OR e.spent_on >= $6)
          AND ($7::date IS NULL OR e.spent_on <= $7)
          AND ($8::text IS NULL OR e.kind = $8)
        ORDER BY ` + orderBy,
    [
      a.trip.id,
      f.q ? `%${f.q.replace(/[\\%_]/g, (c) => '\\' + c)}%` : null,
      f.memberId ?? null,
      f.memberRole,
      f.categoryId ?? null,
      f.from ?? null,
      f.to ?? null,
      f.kind ?? null,
    ],
  );
  const participants = rows.length
    ? await many<ParticipantRow>(
        pool,
        SQL`SELECT expense_id, member_id, split_value, share_amount, position FROM expense_participants
            WHERE expense_id = ANY($1::uuid[]) ORDER BY position`,
        [rows.map((r) => r.id)],
      )
    : [];
  const byExpense = groupParticipants(participants);
  res.json({ expenses: rows.map((r) => withPermission(a, expenseJson(r, byExpense.get(r.id) ?? []))) });
});

financeRouter.get('/expenses/:id', async (req, res) => {
  const a = access(req);
  const found = await loadExpense(pool, a.trip.id, uuid.parse(req.params.id));
  if (!found) throw notFound('Expense not found.');
  res.json({ expense: withPermission(a, expenseJson(found.expense, found.participants)) });
});

financeRouter.post('/expenses', async (req, res) => {
  const a = access(req);
  const { input, payer, participants } = await expenseValues(req, a);
  const saved = await tx(async (db) => {
    const expense = await one<ExpenseRow>(
      db,
      SQL`INSERT INTO expenses (trip_id, kind, title, category_id, amount, paid_by_member_id, split_method, spent_on, spent_at, location, notes, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        a.trip.id,
        input.kind,
        input.title,
        input.categoryId ?? null,
        input.amount,
        payer.id,
        input.splitMethod,
        input.date ?? today(),
        input.time ?? null,
        input.location ?? null,
        input.notes ?? null,
        req.user!.id,
      ],
    );
    await writeParticipants(db, a.trip.id, expense!.id, participants);
    const after = await loadExpense(db, a.trip.id, expense!.id);
    await audit(db, req, {
      tripId: a.trip.id,
      action: 'create',
      entityType: 'expense',
      entityId: expense!.id,
      after: { ...after!.expense, participants: after!.participants },
    });
    const text =
      input.kind === 'refund'
        ? `${payer.name} received a ${money(input.amount, a.trip.currency)} refund: ${input.title}.`
        : `${payer.name} paid ${money(input.amount, a.trip.currency)} for ${input.title}.`;
    await notifyTrip(db, req, a.trip.id, 'expense_added', text, { expenseId: expense!.id });
    return after!;
  });
  res.status(201).json({ expense: withPermission(a, expenseJson(saved.expense, saved.participants)) });
});

financeRouter.put('/expenses/:id', async (req, res) => {
  const a = access(req);
  const id = uuid.parse(req.params.id);
  const before = await loadExpense(pool, a.trip.id, id);
  if (!before) throw notFound('Expense not found.');
  assertCanModify(a, before.expense.created_by);
  const { input, payer, participants } = await expenseValues(req, a);

  const saved = await tx(async (db) => {
    await db.query(
      SQL`UPDATE expenses SET kind = $3, title = $4, category_id = $5, amount = $6, paid_by_member_id = $7, split_method = $8,
            spent_on = $9, spent_at = $10, location = $11, notes = $12, updated_at = now()
          WHERE trip_id = $1 AND id = $2`,
      [
        a.trip.id,
        id,
        input.kind,
        input.title,
        input.categoryId ?? null,
        input.amount,
        payer.id,
        input.splitMethod,
        input.date ?? before.expense.spent_on,
        input.time ?? null,
        input.location ?? null,
        input.notes ?? null,
      ],
    );
    await writeParticipants(db, a.trip.id, id, participants);
    const after = await loadExpense(db, a.trip.id, id);
    await audit(db, req, {
      tripId: a.trip.id,
      action: 'update',
      entityType: 'expense',
      entityId: id,
      before: { ...before.expense, participants: before.participants },
      after: { ...after!.expense, participants: after!.participants },
    });
    await notifyTrip(db, req, a.trip.id, 'expense_updated', `${req.user!.name} edited the expense "${input.title}".`, { expenseId: id });
    return after!;
  });
  res.json({ expense: withPermission(a, expenseJson(saved.expense, saved.participants)) });
});

financeRouter.delete('/expenses/:id', async (req, res) => {
  const a = access(req);
  const id = uuid.parse(req.params.id);
  const before = await loadExpense(pool, a.trip.id, id);
  if (!before) throw notFound('Expense not found.');
  assertCanModify(a, before.expense.created_by);
  await tx(async (db) => {
    await db.query(SQL`DELETE FROM expenses WHERE trip_id = $1 AND id = $2`, [a.trip.id, id]);
    await audit(db, req, {
      tripId: a.trip.id,
      action: 'delete',
      entityType: 'expense',
      entityId: id,
      before: { ...before.expense, participants: before.participants },
    });
  });
  res.status(204).end();
});

// ===========================================================================
// Settlement payments ("David paid John ₹2,000")
// ===========================================================================

financeRouter.get('/settlements', async (req, res) => {
  const a = access(req);
  const rows = await many<SettlementRow>(pool, SQL`SELECT * FROM settlements WHERE trip_id = $1 ORDER BY paid_on DESC, created_at DESC`, [a.trip.id]);
  res.json({ settlements: rows.map((r) => withPermission(a, settlementJson(r))) });
});

async function settlementValues(req: Request, a: TripAccess) {
  const input = settlementSchema.parse(req.body);
  const members = await tripMembers(pool, a.trip.id);
  const from = requireMember(members, input.fromMemberId, 'The sender');
  const to = requireMember(members, input.toMemberId, 'The receiver');
  // Members can record payments they sent or received; owners can record any.
  if (!a.isOwner && from.id !== a.member.id && to.id !== a.member.id) {
    throw forbidden('You can only record payments that you sent or received.');
  }
  return { input, from, to };
}

financeRouter.post('/settlements', async (req, res) => {
  const a = access(req);
  const { input, from, to } = await settlementValues(req, a);
  const row = await tx(async (db) => {
    const created = await one<SettlementRow>(
      db,
      SQL`INSERT INTO settlements (trip_id, from_member_id, to_member_id, amount, paid_on, payment_method, note, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [a.trip.id, from.id, to.id, input.amount, input.date ?? today(), input.paymentMethod, input.note ?? null, req.user!.id],
    );
    await audit(db, req, { tripId: a.trip.id, action: 'create', entityType: 'settlement', entityId: created!.id, after: created });
    await notifyTrip(db, req, a.trip.id, 'settlement_added', `${from.name} paid ${to.name} ${money(input.amount, a.trip.currency)}.`, {
      settlementId: created!.id,
    });
    return created!;
  });
  res.status(201).json({ settlement: withPermission(a, settlementJson(row)) });
});

financeRouter.patch('/settlements/:id', async (req, res) => {
  const a = access(req);
  const id = uuid.parse(req.params.id);
  const before = await one<SettlementRow>(pool, SQL`SELECT * FROM settlements WHERE trip_id = $1 AND id = $2`, [a.trip.id, id]);
  if (!before) throw notFound('Payment not found.');
  assertCanModify(a, before.created_by);
  const { input, from, to } = await settlementValues(req, a);
  const row = await tx(async (db) => {
    const updated = await one<SettlementRow>(
      db,
      SQL`UPDATE settlements SET from_member_id = $3, to_member_id = $4, amount = $5, paid_on = $6, payment_method = $7, note = $8, updated_at = now()
          WHERE trip_id = $1 AND id = $2 RETURNING *`,
      [a.trip.id, id, from.id, to.id, input.amount, input.date ?? before.paid_on, input.paymentMethod, input.note ?? null],
    );
    await audit(db, req, { tripId: a.trip.id, action: 'update', entityType: 'settlement', entityId: id, before, after: updated });
    return updated!;
  });
  res.json({ settlement: withPermission(a, settlementJson(row)) });
});

financeRouter.delete('/settlements/:id', async (req, res) => {
  const a = access(req);
  const id = uuid.parse(req.params.id);
  const before = await one<SettlementRow>(pool, SQL`SELECT * FROM settlements WHERE trip_id = $1 AND id = $2`, [a.trip.id, id]);
  if (!before) throw notFound('Payment not found.');
  assertCanModify(a, before.created_by);
  await tx(async (db) => {
    await db.query(SQL`DELETE FROM settlements WHERE trip_id = $1 AND id = $2`, [a.trip.id, id]);
    await audit(db, req, { tripId: a.trip.id, action: 'delete', entityType: 'settlement', entityId: id, before });
  });
  res.status(204).end();
});
