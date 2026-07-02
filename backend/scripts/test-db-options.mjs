import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function tryConnect(label, config) {
  const pool = new pg.Pool({ ...config, connectionTimeoutMillis: 10_000, max: 1 });
  const started = Date.now();
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT current_database() AS db, current_user AS usr');
      console.log(`OK [${label}] in ${Date.now() - started}ms ->`, result.rows[0]);
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.log(`FAIL [${label}] in ${Date.now() - started}ms ->`, error instanceof Error ? error.message : error);
    return false;
  } finally {
    await pool.end();
  }
}

const shouldUseSsl = String(process.env.DB_SSL ?? 'true').trim().toLowerCase() === 'true';
const rejectUnauthorized = String(process.env.DB_SSL_REJECT_UNAUTHORIZED ?? 'false').trim().toLowerCase() === 'true';
const ssl = shouldUseSsl ? { rejectUnauthorized } : undefined;

const rawUrl = process.env.DATABASE_URL ?? '';
const encodedUrl = rawUrl.replace(
  /^(postgresql:\/\/[^:]+:)([^@]+)(@.+)$/,
  (_, prefix, password, suffix) => `${prefix}${encodeURIComponent(decodeURIComponent(password))}${suffix}`,
);

console.log('Testing connections...\n');

await tryConnect('DATABASE_URL (raw)', { connectionString: rawUrl, ssl });
await tryConnect('DATABASE_URL (encoded password)', { connectionString: encodedUrl, ssl });

await tryConnect('Separate env vars (Supabase)', {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 6543),
  database: process.env.DB_NAME ?? 'postgres',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl,
});

await tryConnect('Local PostgreSQL', {
  host: '127.0.0.1',
  port: 5432,
  database: 'cbis',
  user: 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  ssl: false,
});

await tryConnect('Local PostgreSQL (postgres db)', {
  host: '127.0.0.1',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  ssl: false,
});
