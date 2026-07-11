/**
 * load_aesthetics_reference server tool reads frozen markdown from app root.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { toolLoadAestheticsReference } from '../../server/design/load-aesthetics-reference.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('load_aesthetics_reference tool', () => {
  it('returns the bundled frontend-aesthetics markdown body', async () => {
    const { result } = await toolLoadAestheticsReference(PROJECT_ROOT);
    assert.ok(!result.startsWith('Error:'), result.slice(0, 200));
    assert.match(result, /# Frontend Aesthetics/);
    assert.match(result, /Specificity Ladder/);
    assert.match(result, /Frozen vendor extract/i);
  });

  it('returns Error when reference file is missing', async () => {
    const bogusRoot = path.join(PROJECT_ROOT, 'test/fixtures/memory-home-empty');
    const { result } = await toolLoadAestheticsReference(bogusRoot);
    assert.ok(result.startsWith('Error:'));
    assert.match(result, /missing frontend-aesthetics reference/);
  });
});
