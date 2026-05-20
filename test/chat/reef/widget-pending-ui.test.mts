/**
 * Reef widget pending phase labels and inference.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  applyReefWidgetPendingUi,
  inferReefWidgetBuildPhase,
  reefWidgetPendingLabel,
} from '../../../src/chat/reef/widget-pending-ui.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
}

describe('widget-pending-ui', { concurrency: false }, () => {
  test('inferReefWidgetBuildPhase: building without style', () => {
    assert.equal(inferReefWidgetBuildPhase('<div>x</div>'), 'building');
  });

  test('inferReefWidgetBuildPhase: styling with style but no script', () => {
    assert.equal(
      inferReefWidgetBuildPhase('<style>.x{}</style><div></div>'),
      'styling',
    );
  });

  test('inferReefWidgetBuildPhase: finishing when script appears', () => {
    assert.equal(
      inferReefWidgetBuildPhase('<style></style><div></div><script></script>'),
      'finishing',
    );
  });

  test('reefWidgetPendingLabel matches expected copy', () => {
    assert.equal(reefWidgetPendingLabel('building'), 'Building widget…');
    assert.equal(reefWidgetPendingLabel('styling'), 'Styling…');
    assert.equal(reefWidgetPendingLabel('finishing'), 'Finishing up…');
  });

  test('applyReefWidgetPendingUi adds row and updates label on repeat', () => {
    setupDom();
    const pre = document.createElement('pre');
    pre.setAttribute('data-lang', 'reef-widget');
    const code = document.createElement('code');
    code.textContent = '<div></div>';
    pre.appendChild(code);

    applyReefWidgetPendingUi(pre, 'building');
    assert.ok(pre.classList.contains('reef-widget-pre--pending'));
    assert.equal(
      pre.querySelector('.reef-widget-pending__label')?.textContent,
      'Building widget…',
    );
    assert.equal(pre.querySelectorAll('.reef-widget-pending__dot').length, 3);

    applyReefWidgetPendingUi(pre, 'styling');
    assert.equal(
      pre.querySelector('.reef-widget-pending__label')?.textContent,
      'Styling…',
    );
    assert.equal(pre.querySelectorAll('.reef-widget-pending-status').length, 1);
  });
});
