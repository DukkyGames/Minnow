/**
 * Impeccable reference reader (harness markdown).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { readImpeccableReference } from '../../server/impeccable/reference-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('readImpeccableReference', () => {
  it('returns teach.md content', () => {
    const payload = readImpeccableReference(PROJECT_ROOT, 'teach');
    assert.ok(payload);
    assert.equal(payload.command, 'teach');
    assert.match(payload.content, /# Teach Flow/i);
  });

  it('returns null for unknown command', () => {
    assert.equal(readImpeccableReference(PROJECT_ROOT, 'not-a-real-cmd'), null);
  });

  it('returns null for detect (CLI, not harness reference route)', () => {
    assert.equal(readImpeccableReference(PROJECT_ROOT, 'detect'), null);
  });
});
