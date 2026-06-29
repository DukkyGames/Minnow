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
  it('returns init.md content for init', () => {
    const payload = readImpeccableReference(PROJECT_ROOT, 'init');
    assert.ok(payload);
    assert.equal(payload.command, 'init');
    assert.match(payload.content, /# Init Flow/i);
    assert.match(payload.content, /PRODUCT\.md/);
  });

  it('teach alias returns init.md content', () => {
    const payload = readImpeccableReference(PROJECT_ROOT, 'teach');
    assert.ok(payload);
    assert.equal(payload.command, 'init');
    assert.match(payload.content, /# Init Flow/i);
    assert.match(payload.content, /PRODUCT\.md/);
    assert.doesNotMatch(payload.content, /# Teach Flow/i);
  });

  it('returns null for unknown command', () => {
    assert.equal(readImpeccableReference(PROJECT_ROOT, 'not-a-real-cmd'), null);
  });

  it('returns null for detect (CLI, not harness reference route)', () => {
    assert.equal(readImpeccableReference(PROJECT_ROOT, 'detect'), null);
  });
});
