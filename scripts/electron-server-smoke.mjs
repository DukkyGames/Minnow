/**
 * Smoke test for electron/server-host (MIN-111) without launching Electron.
 * Usage: node scripts/electron-server-smoke.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { setAppRoot } = await import(
  new URL('../server/workspace/root.js', import.meta.url).href
);
const { bootstrapMinnowRuntime } = await import(
  new URL('../server/runtime/bootstrap.js', import.meta.url).href
);
const { startInProcessServer } = await import(
  new URL('../electron/dist/server-host.js', import.meta.url).href
);

setAppRoot(repoRoot);
await bootstrapMinnowRuntime();

const server = await startInProcessServer();
const pingUrl = `${server.url.replace(/\/$/, '')}/api/tools/ping`;
const res = await fetch(pingUrl);
const body = await res.text();

if (!res.ok) {
  console.error('Ping failed:', res.status, body);
  await server.close();
  process.exit(1);
}

console.log('OK', pingUrl, body.slice(0, 120));
await server.close();
console.log('Server closed');
