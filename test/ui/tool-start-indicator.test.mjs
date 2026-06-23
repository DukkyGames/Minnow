import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { attachStreamStatus, attachToolStartIndicator } = await import(
  '../../src/ui/stream-status.ts'
);

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  return window;
}

function makeStreamingRow() {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant msg--awaiting-prose';
  const label = document.createElement('div');
  label.className = 'msg-label';
  wrap.appendChild(label);
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble msg-bubble--awaiting';
  const cursor = document.createElement('div');
  cursor.className = 'cursor cursor--prose';
  bubble.appendChild(cursor);
  wrap.appendChild(bubble);
  const streamStatus = attachStreamStatus(wrap);
  return { wrap, bubble, cursor, streamStatus };
}

describe('attachToolStartIndicator', { concurrency: false }, () => {
  test('show() hides caret and stream status, renders spinner label', () => {
    setupDom();
    const row = makeStreamingRow();
    const handle = attachToolStartIndicator(row);

    handle.show('read_file');

    assert.equal(row.cursor.style.display, 'none');
    const status = row.wrap.querySelector('.stream-status');
    assert.ok(status?.classList.contains('hidden'));

    const indicator = row.wrap.querySelector('.tool-start-indicator');
    assert.ok(indicator);
    assert.equal(indicator?.getAttribute('role'), 'status');
    assert.ok(indicator?.querySelector('.tool-call-spinner'));
    const label = indicator?.querySelector('.tool-start-indicator__label');
    assert.equal(label?.textContent, 'Calling Read file…');

    handle.dispose();
    row.streamStatus.dispose();
  });

  test('show() updates label when tool name changes', () => {
    setupDom();
    const row = makeStreamingRow();
    const handle = attachToolStartIndicator(row);

    handle.show('read_file');
    handle.show('list_dir');

    const label = row.wrap.querySelector('.tool-start-indicator__label');
    assert.equal(label?.textContent, 'Calling list dir…');
    assert.equal(row.wrap.querySelectorAll('.tool-start-indicator').length, 1);

    handle.dispose();
    row.streamStatus.dispose();
  });

  test('dispose() removes indicator node', () => {
    setupDom();
    const row = makeStreamingRow();
    const handle = attachToolStartIndicator(row);
    handle.show('read_file');
    handle.dispose();
    assert.equal(row.wrap.querySelector('.tool-start-indicator'), null);
    row.streamStatus.dispose();
  });
});
