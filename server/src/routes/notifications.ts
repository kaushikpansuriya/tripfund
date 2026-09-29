import { Router } from 'express';
import { many, pool, SQL } from '../db.ts';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const rows = await many<{
    id: string;
    trip_id: string;
    trip_name: string;
    type: string;
    message: string;
    data: unknown;
    read_at: Date | null;
    created_at: Date;
  }>(
    pool,
    SQL`SELECT n.id, n.trip_id, t.name AS trip_name, n.type, n.message, n.data, n.read_at, n.created_at
        FROM notifications n JOIN trips t ON t.id = n.trip_id
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC LIMIT 50`,
    [req.user!.id],
  );
  res.json({
    notifications: rows.map((r) => ({
      id: r.id,
      tripId: r.trip_id,
      tripName: r.trip_name,
      type: r.type,
      message: r.message,
      data: r.data,
      read: r.read_at !== null,
      createdAt: r.created_at,
    })),
    unread: rows.filter((r) => r.read_at === null).length,
  });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await pool.query(SQL`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.user!.id]);
  res.status(204).end();
});
