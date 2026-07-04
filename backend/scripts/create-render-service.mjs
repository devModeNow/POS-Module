import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(path.join(root, '.env'), 'utf8');

function getEnv(name) {
  const line = envText.split('\n').find((row) => row.startsWith(`${name}=`));
  if (!line) throw new Error(`Missing ${name} in backend/.env`);
  return line.slice(name.length + 1).trim();
}

const cliYaml = readFileSync(path.join(process.env.USERPROFILE, '.render', 'cli.yaml'), 'utf8');
const apiKey = cliYaml.match(/key: (rnd_\S+)/)?.[1];
if (!apiKey) throw new Error('Render API key not found. Run render login first.');

const body = {
  type: 'web_service',
  name: 'cbis-backend',
  ownerId: 'tea-d94cevsvikkc73c3p6dg',
  repo: 'https://github.com/devModeNow/POS-Module.git',
  branch: 'master',
  rootDir: 'backend',
  autoDeploy: 'yes',
  serviceDetails: {
    env: 'node',
    plan: 'free',
    region: 'singapore',
    buildCommand: 'npm install && npm run build',
    startCommand: 'npm run start:prod',
    healthCheckPath: '/health',
  },
  envVars: [
    { key: 'NODE_ENV', value: 'production' },
    { key: 'DATABASE_URL', value: getEnv('DATABASE_URL') },
    { key: 'DB_SSL', value: 'true' },
    { key: 'DB_SSL_REJECT_UNAUTHORIZED', value: 'false' },
    { key: 'JWT_SECRET', value: getEnv('JWT_SECRET') },
    { key: 'JWT_EXPIRES_IN', value: '1h' },
    {
      key: 'CORS_ORIGINS',
      value: 'https://frontend-xi-beige-65.vercel.app,http://localhost:4200',
    },
    { key: 'STS_CATERING_ORG_ID', value: '2' },
  ],
};

const response = await fetch('https://api.render.com/v1/services', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await response.text();
if (!response.ok) {
  console.error(`Render API error (${response.status}):`, text);
  process.exit(1);
}

const service = JSON.parse(text);
console.log(JSON.stringify({
  id: service.service?.id ?? service.id,
  name: service.service?.name ?? service.name,
  url: service.service?.serviceDetails?.url ?? service.serviceDetails?.url,
}, null, 2));
