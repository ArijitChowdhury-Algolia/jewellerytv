import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const policyPath = join(root, '.line-policy-exceptions.json');
const excluded = /(^|\/)(node_modules|evaluation|archive|archived|runs|evidence|dist)(\/|$)/;
const source = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    const name = relative(root, absolute).replaceAll('\\', '/');
    if (excluded.test(name)) continue;
    if (entry.isDirectory()) result.push(...(await files(absolute)));
    else if (source.test(entry.name)) result.push(absolute);
  }
  return result;
}

function countLines(text) {
  let inBlock = false;
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      line = line.slice(end + 2).trim();
      inBlock = false;
    }
    if (!line) continue;
    if (line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      const end = line.indexOf('*/', 2);
      if (end < 0) inBlock = true;
      continue;
    }
    if (line.startsWith('*')) continue;
    count += 1;
  }
  return count;
}

const policy = JSON.parse(await readFile(policyPath, 'utf8'));
const exceptions = new Map((policy.exceptions ?? []).map((item) => [item.path, item]));
const overTarget = [];
const failures = [];
for (const absolute of await files(root)) {
  const path = relative(root, absolute).replaceAll('\\', '/');
  const lines = countLines(await readFile(absolute, 'utf8'));
  if (lines > 300) overTarget.push(`${path} (${lines})`);
  if (lines > 500 && !exceptions.has(path)) failures.push(`${path} (${lines})`);
}
if (failures.length) {
  console.error(
    'Handwritten modules over 500 lines need a recorded exception:',
    failures.join(', '),
  );
  process.exit(1);
}
if (overTarget.length) console.warn(`Line-policy target exceeded: ${overTarget.join(', ')}`);
