import { createApp } from './app.ts';
import { cleanExpiredSessions } from './auth.ts';
import { config } from './config.ts';
import { pool } from './db.ts';
import { migrate } from './migrate.ts';

if (config.runMigrations) await migrate();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`TripFund API listening on port ${config.port}`);
});

const cleanup = setInterval(() => cleanExpiredSessions().catch((e) => console.error('Session cleanup failed', e)), 6 * 3_600_000);

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  clearInterval(cleanup);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
