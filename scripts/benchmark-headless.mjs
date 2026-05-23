#!/usr/bin/env node
/**
 * Headless Quick benchmark smoke against a running npm start URL.
 * Usage: node scripts/benchmark-headless.mjs http://localhost:5173
 */

const base = process.argv[2] || 'http://localhost:5173';

async function ping(path) {
  const res = await fetch(`${base}${path}`, { cache: 'no-store' });
  return res.ok;
}

async function main() {
  const toolsOk = await ping('/api/tools/ping');
  const benchListOk = await ping('/api/benchmarks');
  const summary = {
    ok: toolsOk && benchListOk,
    base,
    toolsPing: toolsOk,
    benchmarksApi: benchListOk,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
