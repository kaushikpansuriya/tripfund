/**
 * Static SQL check: finds every SQL`...` statement in src/ and asks PostgreSQL
 * to PREPARE it against the migrated schema. This catches typos in table or
 * column names, wrong parameter types and syntax errors without running the
 * API. Requires `psql` and DATABASE_URL pointing at a migrated database.
 *
 *   DATABASE_URL=postgres://... node scripts/check-sql.ts
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL');
  process.exit(2);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const statements: { file: string; line: number; sql: string }[] = [];
for (const file of files(SRC)) {
  const text = readFileSync(file, 'utf8');
  const re = /SQL`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let sql = m[1].trim();
    if (!/^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(sql)) continue; // fragments (ORDER BY parts)
    if (/ORDER BY$/i.test(sql)) sql += ' 1'; // query completed at runtime with a fixed ORDER BY fragment
    statements.push({ file: file.slice(SRC.length), line: text.slice(0, m.index).split('\n').length, sql });
  }
}

let failed = 0;
for (const [i, s] of statements.entries()) {
  const run = spawnSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `PREPARE check_${i} AS ${s.sql}`], { encoding: 'utf8' });
  if (run.status !== 0) {
    failed++;
    console.error(`✗ ${s.file}:${s.line}\n  ${run.stderr.trim().split('\n').join('\n  ')}\n`);
  }
}
console.log(`${statements.length - failed}/${statements.length} SQL statements are valid.`);
process.exit(failed ? 1 : 0);
