import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Minimal reproduction of the serialized log-write pattern from terminal-runner.
 * Tests that 500 concurrent writes to the same file path do not cause EMFILE
 * and that the output is complete.
 */

/** @type {Map<string, Promise<void>>} */
const writeQueues = new Map();

async function serializedAppend(logPath, text) {
  if (!text) return;
  const prev = writeQueues.get(logPath) ?? Promise.resolve();
  const next = prev.then(async () => {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, text, 'utf8');
  }).catch(() => {
    /* A failed write shouldn't poison the queue for this file. */
  }).finally(() => {
    if (writeQueues.get(logPath) === next) {
      writeQueues.delete(logPath);
    }
  });
  writeQueues.set(logPath, next);
  return next;
}

describe('serialized log write concurrency', () => {
  let tmpDir;
  let logPath;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'log-concurrency-'));
    logPath = path.join(tmpDir, 'test.log');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should handle 500 rapid concurrent writes to the same file without EMFILE', async () => {
    const count = 500;
    const promises = [];

    for (let i = 0; i < count; i++) {
      promises.push(serializedAppend(logPath, `line ${i}\n`));
    }

    // All promises must resolve without throwing
    const results = await Promise.allSettled(promises);
    const rejected = results.filter((r) => r.status === 'rejected');
    if (rejected.length > 0) {
      const errors = rejected.map((r) => r.reason?.message ?? String(r.reason));
      throw new Error(`${rejected.length} writes rejected: ${errors.slice(0, 5).join('; ')}`);
    }

    // Verify the file content has all 500 lines in order
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, count, `Expected ${count} lines, got ${lines.length}`);

    for (let i = 0; i < count; i++) {
      assert.equal(lines[i], `line ${i}`, `Line ${i} mismatch`);
    }
  });

  it('should isolate queues across different file paths', async () => {
    const logPathA = path.join(tmpDir, 'a.log');
    const logPathB = path.join(tmpDir, 'b.log');
    const count = 100;
    const promA = [];
    const promB = [];

    for (let i = 0; i < count; i++) {
      promA.push(serializedAppend(logPathA, `a-${i}\n`));
      promB.push(serializedAppend(logPathB, `b-${i}\n`));
    }

    await Promise.all([...promA, ...promB]);

    const contentA = (await fs.readFile(logPathA, 'utf8')).trim();
    const contentB = (await fs.readFile(logPathB, 'utf8')).trim();

    assert.equal(contentA.split('\n').length, count);
    assert.equal(contentB.split('\n').length, count);
    assert.ok(contentA.startsWith('a-0'));
    assert.ok(contentB.startsWith('b-0'));
  });

  it('should not block future writes after a simulated write failure', async () => {
    const badPath = path.join(tmpDir, 'bad.log');
    // Make the parent a file so mkdir fails — simulating a write failure
    const blocker = path.join(tmpDir, 'blocker');
    await fs.writeFile(blocker, 'block');
    const doomedPath = path.join(blocker, 'nope.log');

    // This write should fail silently (mkdir fails because blocker is a file)
    await serializedAppend(doomedPath, 'should not appear');

    // The queue for doomedPath should be cleaned up; writing to good path still works
    await serializedAppend(badPath, 'survivor\n');
    const content = await fs.readFile(badPath, 'utf8');
    assert.equal(content.trim(), 'survivor');
  });
});
