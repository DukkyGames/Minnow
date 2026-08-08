/**
 * Cleanup plan markdown enhancement — action rows and path highlights.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import { enhanceCleanupPlanMarkup } from '../../src/ui/brain/cleanup-plan-markup.ts';

/** @type {import('happy-dom').Window | undefined} */
let win;

beforeEach(() => {
  win = new Window();
  installHappyDomGlobals(win);
});

afterEach(() => {
  win?.close();
  win = undefined;
});

function mountPlanHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  enhanceCleanupPlanMarkup(root);
  return root;
}

describe('cleanup plan markup', () => {
  test('structures path -> action list items', () => {
    const root = mountPlanHtml(
      '<ul><li>workspaces/demo/wiki/page.md -> drop similarTo</li></ul>',
    );
    const item = root.querySelector('.brain-cleanup-action-item');
    assert.ok(item);
    assert.equal(
      root.querySelector('.brain-cleanup-action-item__target')?.textContent,
      'workspaces/demo/wiki/page.md',
    );
    assert.equal(
      root.querySelector('.brain-cleanup-action-item__verb')?.textContent,
      'drop similarTo',
    );
  });

  test('wraps markdown paths in highlight spans', () => {
    const root = mountPlanHtml('<p>Link facts/overview.md from facts/index.md</p>');
    const paths = root.querySelectorAll('.brain-cleanup-path');
    assert.equal(paths.length, 2);
    assert.equal(paths[0]?.textContent, 'facts/overview.md');
    assert.equal(paths[1]?.textContent, 'facts/index.md');
  });
});
