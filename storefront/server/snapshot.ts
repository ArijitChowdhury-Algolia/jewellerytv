import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';

const agentId = process.argv[2];
if (!agentId || !/^[A-Za-z0-9-]{1,100}$/.test(agentId)) {
  throw new Error('Pass an explicit Agent Studio ID: npm run snapshot -- <agent-id>');
}
const { appId, apiKey } = loadConfig();

const response = await fetch(`https://${appId}.algolia.net/agent-studio/1/agents/${agentId}`, {
  headers: { 'x-algolia-application-id': appId, 'x-algolia-api-key': apiKey },
  redirect: 'error',
});
if (!response.ok) throw new Error(`Read-only agent snapshot failed (${response.status})`);

const configuration = await response.json();
const serialized = JSON.stringify(configuration, null, 2);
if (serialized.includes(apiKey)) throw new Error('Snapshot rejected: credential in configuration');

const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
const hashes = {
  instructions: hash(configuration.instructions),
  systemPrompt: hash(configuration.systemPrompt),
  config: hash(configuration.config),
  tools: hash(configuration.tools),
};
const directory = fileURLToPath(new URL('../evidence/', import.meta.url));
await mkdir(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(
  `${directory}agent-${stamp}.json`,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      agentId,
      hashes,
      sha256: createHash('sha256').update(serialized).digest('hex'),
      configuration,
    },
    null,
    2,
  ) + '\n',
);
console.log('Read-only live agent snapshot saved; no configuration was changed.');
