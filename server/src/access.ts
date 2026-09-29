import type { NextFunction, Request, Response } from 'express';
import { one, pool, SQL } from './db.ts';
import { forbidden, notFound, unauthorized } from './http.ts';
import type { MemberRow, TripRow } from './rows.ts';
import { uuid } from './validation.ts';

export interface TripAccess {
  trip: TripRow;
  /** The logged-in user's membership in this trip. */
  member: MemberRow;
  isOwner: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      access?: TripAccess;
    }
  }
}

/**
 * Loads the trip for /api/trips/:tripId/... and checks that the logged-in user
 * is a member. Trips the user is not part of answer 404 (not 403), so the
 * API never reveals whether a trip exists.
 */
export async function loadTripAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) return next(unauthorized());
  const tripId = uuid.safeParse(req.params.tripId);
  if (!tripId.success) return next(notFound('Trip not found.'));

  const trip = await one<TripRow>(pool, SQL`SELECT * FROM trips WHERE id = $1`, [tripId.data]);
  const member = trip
    ? await one<MemberRow>(pool, SQL`SELECT * FROM trip_members WHERE trip_id = $1 AND user_id = $2`, [tripId.data, req.user.id])
    : null;
  if (!trip || !member) return next(notFound('Trip not found.'));

  req.access = { trip, member, isOwner: member.role === 'owner' };
  next();
}

export function access(req: Request): TripAccess {
  if (!req.access) throw new Error('loadTripAccess middleware is missing');
  return req.access;
}

export function requireOwner(req: Request): TripAccess {
  const a = access(req);
  if (!a.isOwner) throw forbidden('Only the trip owner can do this.');
  return a;
}

/** Owners can change anything. Members can change their own records unless the owner turned that off. */
export function canModify(a: TripAccess, createdBy: string | null): boolean {
  if (a.isOwner) return true;
  return a.trip.member_edit_policy === 'own' && createdBy !== null && createdBy === a.member.user_id;
}

export function assertCanModify(a: TripAccess, createdBy: string | null): void {
  if (!canModify(a, createdBy)) {
    throw forbidden(
      a.trip.member_edit_policy === 'none'
        ? 'Only the trip owner can edit or delete records in this trip.'
        : 'You can only edit or delete records you added yourself.',
    );
  }
}
