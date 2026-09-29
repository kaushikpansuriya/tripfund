import type { Request } from 'express';
import { formatMoney } from '../../packages/engine/src/index.ts';
import { SQL, type Db } from './db.ts';

/** Append a before/after snapshot of a financial change to the audit log. */
export async function audit(
  db: Db,
  req: Request,
  entry: { tripId: string; action: 'create' | 'update' | 'delete'; entityType: string; entityId: string; before?: unknown; after?: unknown },
): Promise<void> {
  await db.query(
    SQL`INSERT INTO audit_logs (trip_id, user_id, action, entity_type, entity_id, before_data, after_data, ip)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.tripId,
      req.user?.id ?? null,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      req.ip ?? null,
    ],
  );
}

/** Notify every other member of the trip who has an account. */
export async function notifyTrip(
  db: Db,
  req: Request,
  tripId: string,
  type: string,
  message: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    SQL`INSERT INTO notifications (user_id, trip_id, type, message, data)
        SELECT m.user_id, $1::uuid, $2::text, $3::text, $4::jsonb
        FROM trip_members m
        WHERE m.trip_id = $1 AND m.user_id IS NOT NULL AND m.user_id <> $5`,
    [tripId, type, message, JSON.stringify(data), req.user?.id ?? null],
  );
}

export const money = (amount: number, currency: string) => formatMoney(amount, currency, { hideZeroDecimals: true });
