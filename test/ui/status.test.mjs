import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setStatus, setReadyStatus } = await import('../../src/ui/status.ts');

function setupDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;

  document.body.innerHTML = `
    <div class="status-pill">
      <div class="s-dot" id="sDot"></div>
      <span id="sText"></span>
    </div>
    <div class="mn-os-mb-status status-pill">
      <div class="s-dot" id="osStatusDot"></div>
      <span id="osStatusText"></span>
    </div>
  `;
}

describe('status', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test('setStatus updates legacy topbar and OS menubar pills', () => {
    setupDom();
    setStatus('spin', 'Loading models…');

    const sDot = document.getElementById('sDot');
    const sText = document.getElementById('sText');
    const osDot = document.getElementById('osStatusDot');
    const osText = document.getElementById('osStatusText');

    assert.equal(sDot?.className, 's-dot spin');
    assert.equal(sText?.textContent, 'Loading models…');
    assert.equal(osDot?.className, 's-dot spin');
    assert.equal(osText?.textContent, 'Loading models…');
  });

  test('setStatus sets title on long messages for both pills', () => {
    setupDom();
    const longMsg = 'Cannot reach one or more providers. Check Settings → Providers.';
    setStatus('err', longMsg);

    assert.equal(document.getElementById('sText')?.getAttribute('title'), longMsg);
    assert.equal(document.getElementById('osStatusText')?.getAttribute('title'), longMsg);
  });

  test('setReadyStatus marks both pills ok', () => {
    setupDom();
    setReadyStatus();

    assert.equal(document.getElementById('sDot')?.className, 's-dot ok');
    assert.equal(document.getElementById('osStatusDot')?.className, 's-dot ok');
    assert.equal(document.getElementById('sText')?.textContent, 'Ready');
    assert.equal(document.getElementById('osStatusText')?.textContent, 'Ready');
  });
});
