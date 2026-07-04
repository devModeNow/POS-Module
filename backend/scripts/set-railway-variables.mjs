import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(path.join(root, '.env'), 'utf8');

function getEnv(name) {
  const line = envText.split('\n').find((row) => row.startsWith(`${name}=`));
  if (!line) throw new Error(`Missing ${name} in backend/.env`);
  return line.slice(name.length + 1).trim();
}

const variables = {
  NODE_ENV: 'production',
  DATABASE_URL: getEnv('DATABASE_URL'),
  DB_SSL: 'true',
  DB_SSL_REJECT_UNAUTHORIZED: 'false',
  JWT_SECRET: getEnv('JWT_SECRET'),
  JWT_EXPIRES_IN: '1h',
  CORS_ORIGINS: 'https://frontend-xi-beige-65.vercel.app,http://localhost:4200',
  STS_CATERING_ORG_ID: '2',
};

const args = ['variable', 'set', ...Object.entries(variables).map(([key, value]) => `${key}=${value}`)];

const result = spawnSync('npx', ['@railway/cli', ...args], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
