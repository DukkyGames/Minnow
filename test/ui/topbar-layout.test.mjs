import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const fixture = JSON.parse(
  readFileSync(join(root, 'test/fixtures/feature01/topbar-zones.json'), 'utf8'),
);

/** Slice of index.html between two markers (exclusive of closing tag of first marker). */
function sliceBetween(htmlText, startMarker, endMarker) {
  const start = htmlText.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const from = start + startMarker.length;
  const end = htmlText.indexOf(endMarker, from);
  assert.ok(end >= 0, `missing ${endMarker} after ${startMarker}`);
  return htmlText.slice(from, end);
}

describe('topbar layout (feature-01)', () => {
  for (const zone of fixture.zones) {
    test(`T1: zone class ${zone}`, () => {
      assert.match(html, new RegExp(`class="${zone}"`));
    });
  }

  test(`T2: spacer class ${fixture.spacer}`, () => {
    assert.match(html, new RegExp(`class="${fixture.spacer}"`));
  });

  test('T3: all action buttons live between topbar-actions and topbar-end', () => {
    const actionsBlock = sliceBetween(html, 'class="topbar-actions"', 'class="topbar-spacer"');
    for (const id of fixture.actionButtonIds) {
      assert.match(actionsBlock, new RegExp(`id="${id}"`));
    }
    assert.doesNotMatch(actionsBlock, /class="model-wrap"/);
    assert.doesNotMatch(actionsBlock, /id="modelSelect"/);
  });

  test('T4–T5: model and status inside topbar-end', () => {
    const endBlock = sliceBetween(html, 'class="topbar-end"', '</header>');
    for (const id of fixture.endIds) {
      assert.match(endBlock, new RegExp(`id="${id}"`));
    }
    assert.match(endBlock, /class="status-pill"/);
    assert.match(endBlock, /class="model-wrap"/);
    assert.match(endBlock, /data-model-state/);
    assert.match(endBlock, /class="model-state-dot"/);
  });

  for (const pattern of fixture.forbiddenPatterns) {
    test(`T6: forbidden pattern ${pattern}`, () => {
      assert.doesNotMatch(html, new RegExp(pattern));
    });
  }

  test('T7: btnNewChatTop removed', () => {
    assert.doesNotMatch(html, /id="btnNewChatTop"/);
  });

  test('T8: btnSidebarToggle has topbar-sidebar-toggle', () => {
    const tag = html.match(/<button[^>]*id="btnSidebarToggle"[^>]*>/);
    assert.ok(tag, 'btnSidebarToggle button');
    assert.match(tag[0], /topbar-sidebar-toggle/);
  });
});
