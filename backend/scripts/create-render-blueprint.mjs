import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliYaml = readFileSync(path.join(process.env.USERPROFILE, '.render', 'cli.yaml'), 'utf8');
const apiKey = cliYaml.match(/key: (rnd_\S+)/)?.[1];
if (!apiKey) throw new Error('Render API key not found');

const body = {
  name: 'cbis-stack',
  repo: 'https://github.com/devModeNow/POS-Module',
  branch: 'master',
  autoDeploy: 'yes',
};

const response = await fetch('https://api.render.com/v1/blueprints', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await response.text();
console.log('status', response.status);
console.log(text);
