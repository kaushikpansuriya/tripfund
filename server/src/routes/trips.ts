import { Router } from 'express';
import { access, requireOwner } from '../access.ts';
import { audit } from '../activity.ts';
import { many, one, pool, SQL, tx, type Db } from '../db.ts';
import { badRequest, conflict, notFound } from '../http.ts';
import { categoryJson, memberJson, tripJson, type CategoryRow, type MemberRow, type TripRow } from '../rows.ts';
import { loadCategories, loadMembers } from '../tripQueries.ts';
import { categorySchema, createTripSchema, memberInputSchema, updateMemberSchema, updateTripSchema, uuid } from '../validation.ts';

// ---------------------------------------------------------------------------
// /api/trips  (list + create)
// ---------------------------------------------------------------------------
export const tripsRouter = Router();

interface TripListRow extends TripRow {
  my_role: 'owner' | 'member';
  my_member_id: string;
  member_count: number;
  total_expenses: number;
  total_contributions: number;
}

tripsRouter.get('/', async (req, res) => {
  const rows = await many<TripListRow>(
    pool,
    SQL`SELECT t.*, me.role AS my_role, me.id AS my_member_id,
               (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id) AS member_count,
               (SELECT coalesce(sum(CASE WHEN e.kind = 'refund' THEN -e.amount ELSE e.amount END), 0) FROM expenses e WHERE e.trip_id = t.id) AS total_expenses,
               (SELECT coalesce(sum(c.amount), 0) FROM contributions c WHERE c.trip_id = t.id) AS total_contributions
        FROM trips t
        JOIN trip_members me ON me.trip_id = t.id AND me.user_id = $1
        ORDER BY t.start_date DESC NULLS LAST, t.created_at DESC`,
    [req.user!.id],
  );
  res.json({
    trips: rows.map((r) => ({
      ...tripJson(r),
      myRole: r.my_role,
      myMemberId: r.my_member_id,
      memberCount: r.member_count,
      totalExpenses: r.total_expenses,
      totalContributions: r.total_contributions,
    })),
  });
});

tripsRouter.post('/', async (req, res) => {
  const input = createTripSchema.parse(req.body);
  const user = req.user!;

  const names = new Set([user.name.toLowerCase()]);
  for (const m of input.members) {
    if (names.has(m.name.toLowerCase())) throw badRequest(`The name "${m.name}" is used twice. Member names must be unique in a trip.`);
    names.add(m.name.toLowerCase());
  }

  const result = await tx(async (db) => {
    const trip = await one<TripRow>(
      db,
      SQL`INSERT INTO trips (created_by, name, destination, description, start_date, end_date, currency)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [user.id, input.name, input.destination ?? null, input.description ?? null, input.startDate ?? null, input.endDate ?? null, input.currency],
    );
    const owner = await one<MemberRow>(
      db,
      SQL`INSERT INTO trip_members (trip_id, user_id, name, email, role, joined_on) VALUES ($1, $2, $3, $4, 'owner', $5) RETURNING *`,
      [trip!.id, user.id, user.name, user.email, input.startDate ?? null],
    );
    for (const m of input.members) {
      await insertMember(db, trip!.id, m.name, m.email ?? null, input.startDate ?? null);
    }
    // The creator holds the trip fund by default (can be changed in settings).
    const updated = await one<TripRow>(db, SQL`UPDATE trips SET fund_holder_member_id = $2 WHERE id = $1 RETURNING *`, [trip!.id, owner!.id]);
    await audit(db, req, { tripId: trip!.id, action: 'create', entityType: 'trip', entityId: trip!.id, after: updated });
    return updated!;
  });

  res.status(201).json({ trip: tripJson(result) });
});

/** Insert a member, linking an existing user account with the same email. */
async function insertMember(db: Db, tripId: string, name: string, email: string | null, joinedOn: string | null) {
  const user = email ? await one<{ id: string }>(db, SQL`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]) : null;
  return one<MemberRow>(
    db,
    SQL`INSERT INTO trip_members (trip_id, user_id, name, email, role, joined_on) VALUES ($1, $2, $3, $4, 'member', $5) RETURNING *`,
    [tripId, user?.id ?? null, name, email, joinedOn],
  );
}

// ---------------------------------------------------------------------------
// /api/trips/:tripId  (trip, members, categories, audit log)
// ---------------------------------------------------------------------------
export const tripRouter = Router({ mergeParams: true });

tripRouter.get('/', async (req, res) => {
  const a = access(req);
  const [members, categories] = await Promise.all([loadMembers(pool, a.trip.id), loadCategories(pool, a.trip.id)]);
  res.json({
    trip: tripJson(a.trip),
    members: members.map(memberJson),
    categories: categories.map(categoryJson),
    me: { memberId: a.member.id, role: a.member.role, isOwner: a.isOwner },
  });
});

tripRouter.patch('/', async (req, res) => {
  const a = requireOwner(req);
  const input = updateTripSchema.parse(req.body);
  const startDate = input.startDate === undefined ? a.trip.start_date : input.startDate;
  const endDate = input.endDate === undefined ? a.trip.end_date : input.endDate;
  if (startDate && endDate && endDate < startDate) throw badRequest('End date must be on or after the start date.');

  if (input.fundHolderMemberId) {
    const holder = await one(pool, SQL`SELECT id FROM trip_members WHERE trip_id = $1 AND id = $2`, [a.trip.id, input.fundHolderMemberId]);
    if (!holder) throw badRequest('The fund holder must be a member of this trip.');
  }

  const updated = await tx(async (db) => {
    const row = await one<TripRow>(
      db,
      SQL`UPDATE trips SET
            name = coalesce($2, name),
            destination = CASE WHEN $3::boolean THEN $4 ELSE destination END,
            description = CASE WHEN $5::boolean THEN $6 ELSE description END,
            start_date = $7,
            end_date = $8,
            currency = coalesce($9, currency),
            fund_holder_member_id = CASE WHEN $10::boolean THEN $11::uuid ELSE fund_holder_member_id END,
            member_edit_policy = coalesce($12, member_edit_policy),
            updated_at = now()
          WHERE id = $1 RETURNING *`,
      [
        a.trip.id,
        input.name ?? null,
        input.destination !== undefined,
        input.destination ?? null,
        input.description !== undefined,
        input.description ?? null,
        startDate,
        endDate,
        input.currency ?? null,
        input.fundHolderMemberId !== undefined,
        input.fundHolderMemberId ?? null,
        input.memberEditPolicy ?? null,
      ],
    );
    await audit(db, req, { tripId: a.trip.id, action: 'update', entityType: 'trip', entityId: a.trip.id, before: a.trip, after: row });
    return row!;
  });
  res.json({ trip: tripJson(updated) });
});

tripRouter.delete('/', async (req, res) => {
  const a = requireOwner(req);
  await tx(async (db) => {
    await audit(db, req, { tripId: a.trip.id, action: 'delete', entityType: 'trip', entityId: a.trip.id, before: a.trip });
    await db.query(SQL`DELETE FROM trips WHERE id = $1`, [a.trip.id]);
  });
  res.status(204).end();
});

// Members ---------------------------------------------------------------------

tripRouter.post('/members', async (req, res) => {
  const a = requireOwner(req);
  const input = memberInputSchema.parse(req.body);
  const member = await tx(async (db) => {
    const created = await insertMember(db, a.trip.id, input.name, input.email ?? null, new Date().toISOString().slice(0, 10));
    await audit(db, req, { tripId: a.trip.id, action: 'create', entityType: 'member', entityId: created!.id, after: created });
    return created!;
  });
  res.status(201).json({ member: memberJson(member) });
});

tripRouter.patch('/members/:memberId', async (req, res) => {
  const a = requireOwner(req);
  const memberId = uuid.parse(req.params.memberId);
  const input = updateMemberSchema.parse(req.body);
  const before = await one<MemberRow>(pool, SQL`SELECT * FROM trip_members WHERE trip_id = $1 AND id = $2`, [a.trip.id, memberId]);
  if (!before) throw notFound('Member not found.');

  if (input.role === 'member' && before.role === 'owner') {
    const owners = await one<{ n: number }>(pool, SQL`SELECT count(*) AS n FROM trip_members WHERE trip_id = $1 AND role = 'owner'`, [a.trip.id]);
    if ((owners?.n ?? 0) <= 1) throw conflict('A trip needs at least one owner. Make someone else owner first.');
  }
  if (input.role === 'owner' && !before.user_id) {
    throw badRequest('Only members with an account can be owners. Add their email so they can sign up first.');
  }

  let linkUserId: string | null = before.user_id;
  if (input.email && !before.user_id) {
    const user = await one<{ id: string }>(pool, SQL`SELECT id FROM users WHERE lower(email) = lower($1)`, [input.email]);
    linkUserId = user?.id ?? null;
  }

  const status = input.status ?? before.status;
  const leftOn = input.leftOn !== undefined ? input.leftOn : status === 'left' ? (before.left_on ?? new Date().toISOString().slice(0, 10)) : null;

  const member = await tx(async (db) => {
    const row = await one<MemberRow>(
      db,
      SQL`UPDATE trip_members SET
            name = coalesce($3, name),
            email = CASE WHEN $4::boolean THEN $5 ELSE email END,
            user_id = $6,
            role = coalesce($7, role),
            status = $8,
            joined_on = CASE WHEN $9::boolean THEN $10::date ELSE joined_on END,
            left_on = $11,
            updated_at = now()
          WHERE trip_id = $1 AND id = $2 RETURNING *`,
      [
        a.trip.id,
        memberId,
        input.name ?? null,
        input.email !== undefined,
        input.email ?? null,
        linkUserId,
        input.role ?? null,
        status,
        input.joinedOn !== undefined,
        input.joinedOn ?? null,
        status === 'left' ? leftOn : null,
      ],
    );
    await audit(db, req, { tripId: a.trip.id, action: 'update', entityType: 'member', entityId: memberId, before, after: row });
    return row!;
  });
  res.json({ member: memberJson(member) });
});

tripRouter.delete('/members/:memberId', async (req, res) => {
  const a = requireOwner(req);
  const memberId = uuid.parse(req.params.memberId);
  const before = await one<MemberRow>(pool, SQL`SELECT * FROM trip_members WHERE trip_id = $1 AND id = $2`, [a.trip.id, memberId]);
  if (!before) throw notFound('Member not found.');
  if (before.id === a.trip.fund_holder_member_id) throw conflict('This member holds the trip fund. Choose another fund holder first.');
  if (before.role === 'owner') throw conflict('Owners cannot be removed. Change their role to member first.');

  const used = await one<{ used: boolean }>(
    pool,
    SQL`SELECT EXISTS (SELECT 1 FROM contributions WHERE trip_id = $1 AND (member_id = $2 OR received_by_member_id = $2))
            OR EXISTS (SELECT 1 FROM expenses WHERE trip_id = $1 AND paid_by_member_id = $2)
            OR EXISTS (SELECT 1 FROM expense_participants WHERE trip_id = $1 AND member_id = $2)
            OR EXISTS (SELECT 1 FROM settlements WHERE trip_id = $1 AND (from_member_id = $2 OR to_member_id = $2)) AS used`,
    [a.trip.id, memberId],
  );
  if (used?.used) {
    throw conflict('This member is part of expenses or payments, so they cannot be removed. Mark them as "left" instead.');
  }
  await tx(async (db) => {
    await db.query(SQL`DELETE FROM trip_members WHERE trip_id = $1 AND id = $2`, [a.trip.id, memberId]);
    await audit(db, req, { tripId: a.trip.id, action: 'delete', entityType: 'member', entityId: memberId, before });
  });
  res.status(204).end();
});

// Categories ------------------------------------------------------------------

tripRouter.post('/categories', async (req, res) => {
  const a = requireOwner(req);
  const input = categorySchema.parse(req.body);
  const clash = await one(
    pool,
    SQL`SELECT id FROM expense_categories WHERE (trip_id IS NULL OR trip_id = $1) AND lower(name) = lower($2)`,
    [a.trip.id, input.name],
  );
  if (clash) throw conflict(`A category called "${input.name}" already exists.`);
  const row = await one<CategoryRow>(
    pool,
    SQL`INSERT INTO expense_categories (trip_id, name, icon, sort_order) VALUES ($1, $2, $3, 50) RETURNING id, trip_id, name, icon, sort_order`,
    [a.trip.id, input.name, input.icon ?? null],
  );
  res.status(201).json({ category: categoryJson(row!) });
});

tripRouter.delete('/categories/:categoryId', async (req, res) => {
  const a = requireOwner(req);
  const categoryId = uuid.parse(req.params.categoryId);
  const row = await one<CategoryRow>(pool, SQL`SELECT id, trip_id, name, icon, sort_order FROM expense_categories WHERE id = $1 AND trip_id = $2`, [
    categoryId,
    a.trip.id,
  ]);
  if (!row) throw notFound('Custom category not found. Built-in categories cannot be deleted.');
  const used = await one(pool, SQL`SELECT 1 FROM expenses WHERE trip_id = $1 AND category_id = $2 LIMIT 1`, [a.trip.id, categoryId]);
  if (used) throw conflict('This category is used by expenses. Move those expenses to another category first.');
  await pool.query(SQL`DELETE FROM expense_categories WHERE id = $1 AND trip_id = $2`, [categoryId, a.trip.id]);
  res.status(204).end();
});

// Audit log (owners) --------------------------------------------------------

tripRouter.get('/audit', async (req, res) => {
  const a = requireOwner(req);
  const rows = await many<{
    id: number;
    user_id: string | null;
    user_name: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    before_data: unknown;
    after_data: unknown;
    created_at: Date;
  }>(
    pool,
    SQL`SELECT l.id, l.user_id, u.name AS user_name, l.action, l.entity_type, l.entity_id, l.before_data, l.after_data, l.created_at
        FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.trip_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT 500`,
    [a.trip.id],
  );
  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: r.before_data,
      after: r.after_data,
      createdAt: r.created_at,
    })),
  });
});
