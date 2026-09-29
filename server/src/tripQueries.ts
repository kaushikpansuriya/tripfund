/** Database loading for a trip's records. */
import { many, pool, SQL, type Db } from './db.ts';
import type { CategoryRow, ContributionRow, ExpenseRow, MemberRow, ParticipantRow, SettlementRow, TripRow } from './rows.ts';
import type { TripData } from './tripData.ts';

export async function loadMembers(db: Db, tripId: string): Promise<MemberRow[]> {
  return many<MemberRow>(db, SQL`SELECT * FROM trip_members WHERE trip_id = $1 ORDER BY created_at, name`, [tripId]);
}

export async function loadCategories(db: Db, tripId: string): Promise<CategoryRow[]> {
  return many<CategoryRow>(
    db,
    SQL`SELECT id, trip_id, name, icon, sort_order FROM expense_categories
        WHERE trip_id IS NULL OR trip_id = $1
        ORDER BY sort_order, lower(name)`,
    [tripId],
  );
}

export async function loadTripData(trip: TripRow, db: Db = pool): Promise<TripData> {
  const [members, categories, contributions, expenses, participants, settlements] = await Promise.all([
    loadMembers(db, trip.id),
    loadCategories(db, trip.id),
    many<ContributionRow>(db, SQL`SELECT * FROM contributions WHERE trip_id = $1 ORDER BY contributed_on, created_at`, [trip.id]),
    many<ExpenseRow>(db, SQL`SELECT * FROM expenses WHERE trip_id = $1 ORDER BY spent_on, spent_at NULLS FIRST, created_at`, [trip.id]),
    many<ParticipantRow>(
      db,
      SQL`SELECT expense_id, member_id, split_value, share_amount, position FROM expense_participants WHERE trip_id = $1 ORDER BY expense_id, position`,
      [trip.id],
    ),
    many<SettlementRow>(db, SQL`SELECT * FROM settlements WHERE trip_id = $1 ORDER BY paid_on, created_at`, [trip.id]),
  ]);
  return { trip, members, categories, contributions, expenses, participants, settlements };
}
