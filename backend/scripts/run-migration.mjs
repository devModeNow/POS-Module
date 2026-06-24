import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: node scripts/run-migration.mjs <path-to-sql>');
  process.exit(1);
}

const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const databaseUrl = env.DATABASE_URL.includes('sslmode=')
  ? env.DATABASE_URL.replace(/sslmode=[^&]*/i, 'sslmode=no-verify')
  : `${env.DATABASE_URL}${env.DATABASE_URL.includes('?') ? '&' : '?'}sslmode=no-verify`;

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  const sql = fs.readFileSync(path.resolve(sqlFile), 'utf8');
  await pool.query(sql);
  console.log(`Migration applied: ${path.basename(sqlFile)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
