import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/step01/stream-labels.json'), 'utf8'),
);

const { attachStreamStatus, STREAM_LABEL_GENERATING, STREAM_LABEL_LOADING_MODEL, STREAM_LABEL_THINKING } =
  await import('../../src/ui/stream-status.ts');

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  return window;
}

describe('stream-status', { concurrency: false }, () => {
test('attachStreamStatus starts in generating', () => {
  setupDom();
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const label = document.createElement('div');
  label.className = 'msg-label';
  wrap.appendChild(label);
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble msg-bubble--awaiting';
  wrap.appendChild(bubble);

  const handle = attachStreamStatus(wrap);
  const status = wrap.querySelector('.stream-status');
  const labelEl = status?.querySelector('.stream-status__label');

  assert.ok(status);
  assert.equal(labelEl?.textContent, fixtures.generating);
  assert.equal(labelEl?.textContent, STREAM_LABEL_GENERATING);
  assert.equal(status?.getAttribute('aria-busy'), 'true');
  handle.dispose();
});

test("setPhase('loading_model') updates label", () => {
  setupDom();
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="msg-label"></div><div class="msg-bubble"></div>';
  const handle = attachStreamStatus(wrap);

  handle.setPhase('loading_model');
  const labelEl = wrap.querySelector('.stream-status__label');
  assert.equal(labelEl?.textContent, STREAM_LABEL_LOADING_MODEL);
  assert.ok(wrap.querySelector('.stream-status--loading-model'));

  handle.dispose();
});

test("setPhase('thinking') updates label", () => {
  setupDom();
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="msg-label"></div><div class="msg-bubble"></div>';
  const handle = attachStreamStatus(wrap);

  handle.setPhase('thinking');
  const labelEl = wrap.querySelector('.stream-status__label');
  assert.equal(labelEl?.textContent, fixtures.thinking);
  assert.equal(labelEl?.textContent, STREAM_LABEL_THINKING);

  handle.dispose();
});

test("setPhase('prose') hides status and clears aria-busy", () => {
  setupDom();
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="msg-label"></div><div class="msg-bubble"></div>';
  const handle = attachStreamStatus(wrap);

  handle.setPhase('prose');
  const status = wrap.querySelector('.stream-status');
  assert.ok(status?.classList.contains('hidden'));
  assert.equal(status?.getAttribute('aria-busy'), 'false');

  handle.dispose();
});

test('dispose() removes status node', () => {
  setupDom();
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="msg-label"></div><div class="msg-bubble"></div>';
  const handle = attachStreamStatus(wrap);
  handle.dispose();
  assert.equal(wrap.querySelector('.stream-status'), null);
});

test('setThinkingElapsed shows suffix in thinking phase', () => {
  setupDom();
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="msg-label"></div><div class="msg-bubble"></div>';
  const handle = attachStreamStatus(wrap);

  handle.setPhase('thinking');
  handle.setThinkingElapsed(4200);

  const elapsed = wrap.querySelector('.stream-status__elapsed');
  assert.ok(elapsed);
  assert.equal(elapsed.hidden, false);
  assert.match(elapsed.textContent ?? '', /4\.2s/);

  handle.setPhase('generating');
  assert.equal(elapsed.hidden, true);

  handle.dispose();
});
});
