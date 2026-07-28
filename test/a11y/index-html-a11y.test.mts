/**
 * Static accessibility checks on index.html shell markup.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const INDEX_HTML = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

describe('index.html a11y shell', () => {
  test('model select trigger exposes listbox popup semantics', () => {
    assert.match(INDEX_HTML, /id="modelSelectTrigger"/);
    assert.match(INDEX_HTML, /aria-haspopup="listbox"/);
    assert.match(INDEX_HTML, /id="modelSelectMenu"[^>]*role="listbox"/);
    assert.match(INDEX_HTML, /id="modelSelectLabel"/);
  });

  test('app loader exposes busy status region', () => {
    assert.match(INDEX_HTML, /id="app-loader"[^>]*role="status"/);
    assert.match(INDEX_HTML, /aria-live="polite"/);
  });

  test('native model select is present as SR fallback', () => {
    assert.match(INDEX_HTML, /id="modelSelect"[^>]*class="model-select-native"/);
  });
});
