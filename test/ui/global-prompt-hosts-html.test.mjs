import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('global prompt hosts HTML', () => {
  test('global tool approval host exists in os stage', () => {
    assert.match(html, /id="globalToolApprovalHost"/);
    assert.match(html, /id="globalQuestionHost"/);
  });
});
