import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { hashSync } from 'bcryptjs';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const match = env.match(/^DATABASE_URL=(.+)$/m);
if (!match) {
  console.error('DATABASE_URL not found in backend/.env');
  process.exit(1);
}

const password = process.argv[2] ?? 'superadmin';
const hash = hashSync(password, 10);
const pool = new Pool({
  connectionString: match[1].trim(),
  ssl: { rejectUnauthorized: false },
});

try {
  const users = await pool.query(
    `SELECT id, username, status FROM tblusers ORDER BY id`,
  );
  if (users.rowCount === 0) {
    console.error('No users found in tblusers.');
    process.exit(1);
  }

  console.log('Users in database:');
  for (const row of users.rows) {
    console.log(`- id=${row.id} username=${row.username} status=${row.status}`);
  }

  const targetUsername = process.argv[2] ?? String(users.rows[0].username ?? '').trim();
  if (!targetUsername) {
    console.error('Could not determine target username.');
    process.exit(1);
  }

  const result = await pool.query(
    `UPDATE tblusers SET password = $1 WHERE username = $2`,
    [hash, targetUsername],
  );
  console.log(`Updated ${result.rowCount} row(s) for username "${targetUsername}".`);
  if (result.rowCount === 0) {
    console.error(`No user found with username "${targetUsername}".`);
    process.exit(1);
  }
  console.log(`Temporary password set to: ${password}`);
} finally {
  await pool.end();
}
