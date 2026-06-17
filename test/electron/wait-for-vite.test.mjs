import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { waitForVite } from '../../scripts/wait-for-vite.mjs';

test('waitForVite resolves when the dev server returns 200', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html>');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;
  const url = await waitForVite(port, { timeoutMs: 5_000, intervalMs: 50 });
  assert.equal(url, `http://127.0.0.1:${port}/`);

  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test('waitForVite times out when nothing is listening', async () => {
  await assert.rejects(
    () => waitForVite(59999, { timeoutMs: 300, intervalMs: 50 }),
    /Timed out waiting for Vite/,
  );
});
