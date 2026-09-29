import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';
import { one, pool, SQL } from './db.ts';
import { forbidden, unauthorized } from './http.ts';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthSession {
  id: string;
  csrfToken: string;
  viaCookie: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      authSession?: AuthSession;
    }
  }
}

export const SESSION_COOKIE = 'tf_session';
export const CSRF_COOKIE = 'tf_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// ---------------------------------------------------------------------------
// Passwords: scrypt with a random salt, stored as scrypt$N$r$p$salt$hash
// ---------------------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptAsync(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Used when the email is unknown, so login takes the same time either way. */
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(16).toString('hex'));

// ---------------------------------------------------------------------------
// Sessions: random token in an httpOnly cookie (browser) or Bearer header (apps).
// Only the SHA-256 of the token is stored.
// ---------------------------------------------------------------------------
const sha256 = (value: string) => createHash('sha256').update(value).digest();

export async function createSession(userId: string, req: Request): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionDays * 86_400_000);
  await pool.query(
    SQL`INSERT INTO sessions (user_id, token_hash, csrf_token, user_agent, ip, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, sha256(token), csrfToken, (req.get('user-agent') ?? '').slice(0, 300), req.ip ?? null, expiresAt],
  );
  return { token, csrfToken, expiresAt };
}

export function setSessionCookies(res: Response, session: { token: string; csrfToken: string; expiresAt: Date }): void {
  const base = { secure: config.cookieSecure, sameSite: 'lax' as const, path: '/', expires: session.expiresAt };
  res.cookie(SESSION_COOKIE, session.token, { ...base, httpOnly: true });
  res.cookie(CSRF_COOKIE, session.csrfToken, { ...base, httpOnly: false });
}

export function clearSessionCookies(res: Response): void {
  const base = { secure: config.cookieSecure, sameSite: 'lax' as const, path: '/' };
  res.clearCookie(SESSION_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, base);
}

export async function destroySession(sessionId: string): Promise<void> {
  await pool.query(SQL`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface SessionRow {
  session_id: string;
  csrf_token: string;
  last_used_at: Date;
  user_id: string;
  name: string;
  email: string;
}

/** Attach req.user when a valid session token is present. Never rejects. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const bearer = req.get('authorization');
  const bearerToken = bearer?.startsWith('Bearer ') ? bearer.slice(7).trim() : null;
  const token = bearerToken || readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 200) return next();

  const row = await one<SessionRow>(
    pool,
    SQL`SELECT s.id AS session_id, s.csrf_token, s.last_used_at, u.id AS user_id, u.name, u.email
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (row) {
    req.user = { id: row.user_id, name: row.name, email: row.email };
    req.authSession = { id: row.session_id, csrfToken: row.csrf_token, viaCookie: !bearerToken };
    if (Date.now() - new Date(row.last_used_at).getTime() > 3_600_000) {
      pool.query(SQL`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [row.session_id]).catch(() => undefined);
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-based sessions (double submit): the browser app
 * reads the tf_csrf cookie and sends it back in the X-CSRF-Token header.
 * A different site can make the browser send cookies but cannot read them.
 * Bearer-token requests are not exposed to CSRF and skip this check.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || !req.authSession?.viaCookie) return next();
  const sent = req.get(CSRF_HEADER) ?? '';
  const expected = req.authSession.csrfToken;
  const ok = sent.length === expected.length && timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return next(forbidden('Security check failed. Please reload the page and try again.'));
  next();
}

export async function cleanExpiredSessions(): Promise<void> {
  await pool.query(SQL`DELETE FROM sessions WHERE expires_at < now()`);
}
