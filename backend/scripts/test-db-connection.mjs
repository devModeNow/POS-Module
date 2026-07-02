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

const databaseUrl = process.env.DATABASE_URL;
const shouldUseSsl = String(process.env.DB_SSL ?? '').trim().toLowerCase() === 'true'
  || Boolean(databaseUrl?.includes('sslmode=require'));
const rejectUnauthorized = String(process.env.DB_SSL_REJECT_UNAUTHORIZED ?? 'false').trim().toLowerCase() === 'true';
const ssl = shouldUseSsl ? { rejectUnauthorized } : undefined;

const pool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl, ssl, connectionTimeoutMillis: 10_000 })
  : new pg.Pool({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'postgres',
      user: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? '',
      ssl,
      connectionTimeoutMillis: 10_000,
    });

const started = Date.now();
try {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT 1 AS ok');
    console.log('DB connected in', Date.now() - started, 'ms');
    console.log('result:', result.rows[0]);
  } finally {
    client.release();
  }
} catch (error) {
  console.error('DB connection failed in', Date.now() - started, 'ms');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
