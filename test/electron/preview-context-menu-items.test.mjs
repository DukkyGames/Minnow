import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

/**
 * Pure menu-item builder for the preview guest context menu.
 * Requires `npm run electron:build` so dist includes preview-context-menu-items.js.
 */
const { buildPreviewContextMenuItems } = await import(
  '../../electron/dist/preview-context-menu-items.js'
);

function labels(items) {
  return items.filter((i) => i.type === 'item').map((i) => i.label);
}

function item(items, role) {
  return items.find((i) => i.type === 'item' && i.role === role);
}

describe('buildPreviewContextMenuItems', () => {
  test('always includes navigation + Inspect + Send to chat', () => {
    const items = buildPreviewContextMenuItems({
      params: {},
      canGoBack: false,
      canGoForward: false,
    });
    assert.deepEqual(labels(items).slice(0, 3), ['Back', 'Forward', 'Reload']);
    assert.equal(item(items, 'goBack').enabled, false);
    assert.equal(item(items, 'goForward').enabled, false);
    assert.equal(item(items, 'reload').enabled, true);
    assert.ok(item(items, 'inspect'));
    assert.ok(item(items, 'sendToChat'));
  });

  test('enables Back/Forward from navigation flags', () => {
    const items = buildPreviewContextMenuItems({
      params: {},
      canGoBack: true,
      canGoForward: true,
    });
    assert.equal(item(items, 'goBack').enabled, true);
    assert.equal(item(items, 'goForward').enabled, true);
  });

  test('adds link actions when linkURL is set', () => {
    const items = buildPreviewContextMenuItems({
      params: { linkURL: 'https://example.com/docs' },
      canGoBack: false,
      canGoForward: false,
    });
    assert.ok(item(items, 'openLinkInNewTab'));
    assert.ok(item(items, 'copyLink'));
    assert.ok(item(items, 'openExternal'));
  });

  test('adds image actions when mediaType is image', () => {
    const items = buildPreviewContextMenuItems({
      params: { mediaType: 'image', srcURL: 'https://example.com/a.png' },
      canGoBack: false,
      canGoForward: false,
    });
    assert.ok(item(items, 'copyImage'));
    assert.equal(item(items, 'copyImageAddress').enabled, true);
    assert.equal(item(items, 'saveImage').enabled, true);
  });

  test('disables image address/save when srcURL is empty', () => {
    const items = buildPreviewContextMenuItems({
      params: { mediaType: 'image', srcURL: '' },
      canGoBack: false,
      canGoForward: false,
    });
    assert.equal(item(items, 'copyImageAddress').enabled, false);
    assert.equal(item(items, 'saveImage').enabled, false);
  });

  test('adds edit actions for editable fields', () => {
    const items = buildPreviewContextMenuItems({
      params: {
        isEditable: true,
        editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
      },
      canGoBack: false,
      canGoForward: false,
    });
    assert.equal(item(items, 'cut').enabled, true);
    assert.equal(item(items, 'copy').enabled, true);
    assert.equal(item(items, 'paste').enabled, true);
    assert.equal(item(items, 'selectAll').enabled, true);
  });

  test('adds spellcheck suggestions + add to dictionary', () => {
    const items = buildPreviewContextMenuItems({
      params: {
        misspelledWord: 'teh',
        dictionarySuggestions: ['the', 'tea'],
      },
      canGoBack: false,
      canGoForward: false,
    });
    const suggestions = items.filter(
      (i) => i.type === 'item' && i.role === 'replaceMisspelling',
    );
    assert.equal(suggestions.length, 2);
    assert.equal(suggestions[0].suggestion, 'the');
    assert.ok(item(items, 'addToDictionary'));
  });
});
