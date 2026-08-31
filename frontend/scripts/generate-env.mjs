import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');

if (existsSync(envPath)) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  } else {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

const apiUrl = (
  process.env.API_URL?.trim() ||
  process.env.NG_APP_API_BASE_URL?.trim() ||
  process.env.NG_APP_API_URL?.trim() ||
  'http://localhost:3000'
).replace(/\/+$/, '');

const publicSiteUrl = (
  process.env.PUBLIC_SITE_URL?.trim() ||
  process.env.NG_APP_PUBLIC_SITE_URL?.trim() ||
  'http://localhost:4200'
).replace(/\/+$/, '');

const buildId =
  process.env.BUILD_ID?.trim() ||
  process.env.GITHUB_SHA?.trim() ||
  'local';

const escape = (value) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const content = `// Auto-generated from frontend/.env and process env — do not edit manually.
// Regenerated when you run \`npm start\` or \`npm run build\`.

export const ENV = {
  API_URL: '${escape(apiUrl)}',
  PUBLIC_SITE_URL: '${escape(publicSiteUrl)}',
  BUILD_ID: '${escape(buildId)}',
} as const;
`;

const generatedDir = resolve(root, 'src/app/shared/config');
mkdirSync(generatedDir, { recursive: true });
writeFileSync(resolve(generatedDir, 'env.generated.ts'), content, 'utf8');
writeFileSync(
  resolve(root, 'public/app-version.json'),
  `${JSON.stringify({ buildId }, null, 2)}\n`,
  'utf8',
);

console.log('[env] API_URL:', apiUrl);
console.log('[env] PUBLIC_SITE_URL:', publicSiteUrl);
console.log('[env] BUILD_ID:', buildId);
