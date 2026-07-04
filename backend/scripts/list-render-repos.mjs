import { readFileSync } from 'node:fs';
import path from 'node:path';

const cliYaml = readFileSync(path.join(process.env.USERPROFILE, '.render', 'cli.yaml'), 'utf8');
const apiKey = cliYaml.match(/key: (rnd_\S+)/)?.[1];
if (!apiKey) throw new Error('Render API key not found');

const endpoints = [
  'https://api.render.com/v1/repos?ownerId=tea-d94cevsvikkc73c3p6dg&limit=50',
  'https://api.render.com/v1/owners/te-d94cevsvikkc73c3p6dg/repos',
];

for (const url of endpoints) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  console.log('\nURL:', url);
  console.log('Status:', response.status);
  console.log(await response.text());
}
