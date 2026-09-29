import { fileURLToPath } from 'node:url';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', nodeEnv === 'production' ? undefined : 'postgres://tripfund:tripfund@localhost:5432/tripfund'),
  /** Send cookies only over HTTPS. Turn off only for local http:// testing. */
  cookieSecure: (process.env.COOKIE_SECURE ?? (nodeEnv === 'production' ? 'true' : 'false')) === 'true',
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  /** Number of reverse proxies in front of the API (nginx = 1). Used for client IPs and rate limits. */
  trustProxy: Number(process.env.TRUST_PROXY ?? 1),
  runMigrations: (process.env.RUN_MIGRATIONS ?? 'true') === 'true',
  /** Built web app to serve (if present). Default: ../web/dist next to the server folder. */
  webDist: process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist/', import.meta.url)),
};
