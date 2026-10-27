import pg from 'pg';
import { config } from './config.ts';

// int8 (bigint) → number. Safe: every amount is limited to MAX_AMOUNT (< 2^53).
pg.types.setTypeParser(20, (value: string) => Number(value));
// numeric → number (sums, split values with 2 decimals)
pg.types.setTypeParser(1700, (value: string) => Number(value));
// date → keep as 'YYYY-MM-DD' string (no timezone shifting)
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: process.env.VERCEL === '1' ? 2 : 10,
  idleTimeoutMillis: 30_000,
});

export type Db = pg.Pool | pg.PoolClient;

/**
 * Tag for SQL text. It refuses interpolation at compile time (values must be
 * passed as $1, $2 … parameters), which rules out SQL injection, and lets
 * `npm run check:sql` find and verify every statement against the schema.
 */
export function SQL(strings: TemplateStringsArray, ...values: never[]): string {
  if (values.length > 0) throw new Error('Do not interpolate values into SQL. Use $n parameters.');
  return strings.join('');
}

export async function many<T>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(text, params);
  return result.rows as T[];
}

export async function one<T>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const result = await db.query(text, params);
  return (result.rows[0] as T | undefined) ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
