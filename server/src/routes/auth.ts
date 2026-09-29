import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  clearSessionCookies,
  createSession,
  destroySession,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  requireAuth,
  setSessionCookies,
  verifyPassword,
} from '../auth.ts';
import { many, one, pool, SQL, tx } from '../db.ts';
import { conflict, HttpError } from '../http.ts';
import { loginSchema, registerSchema } from '../validation.ts';

export const authRouter = Router();

// Brute-force protection: 20 login/register attempts per 15 minutes per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } },
});

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
}

authRouter.post('/register', authLimiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await hashPassword(input.password);

  const user = await tx(async (db) => {
    const existing = await one<{ id: string }>(db, SQL`SELECT id FROM users WHERE lower(email) = lower($1)`, [input.email]);
    if (existing) throw conflict('An account with this email already exists. Please log in.');
    const created = await one<UserRow>(
      db,
      SQL`INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, password_hash`,
      [input.name, input.email, passwordHash],
    );
    // Link this account to trips where someone already added this email as a member.
    await db.query(
      SQL`UPDATE trip_members SET user_id = $1, updated_at = now() WHERE lower(email) = lower($2) AND user_id IS NULL`,
      [created!.id, input.email],
    );
    return created!;
  });

  const session = await createSession(user.id, req);
  setSessionCookies(res, session);
  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email },
    csrfToken: session.csrfToken,
    // For mobile apps: send as "Authorization: Bearer <token>".
    token: req.body?.wantToken === true ? session.token : undefined,
  });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await one<UserRow>(pool, SQL`SELECT id, name, email, password_hash FROM users WHERE lower(email) = lower($1)`, [input.email]);
  const valid = await verifyPassword(input.password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) throw new HttpError(401, 'INVALID_LOGIN', 'Email or password is incorrect.');

  const session = await createSession(user.id, req);
  setSessionCookies(res, session);
  res.json({
    user: { id: user.id, name: user.name, email: user.email },
    csrfToken: session.csrfToken,
    token: req.body?.wantToken === true ? session.token : undefined,
  });
});

authRouter.post('/logout', async (req, res) => {
  if (req.authSession) await destroySession(req.authSession.id);
  clearSessionCookies(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const counts = await many<{ trips: number }>(pool, SQL`SELECT count(*) AS trips FROM trip_members WHERE user_id = $1`, [req.user!.id]);
  res.json({ user: req.user, csrfToken: req.authSession?.csrfToken ?? null, tripCount: counts[0]?.trips ?? 0 });
});
