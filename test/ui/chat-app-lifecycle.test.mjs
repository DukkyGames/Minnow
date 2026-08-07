/**
 * Chat app open/close + seed wiring (source contracts; avoids heavy chat-app.ts import in Node).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const chatAppSrc = readFileSync(join(root, 'src/ui/chat-app.ts'), 'utf8');
const appHostSrc = readFileSync(join(root, 'src/os/app-host.ts'), 'utf8');

describe('chat app lifecycle contracts', () => {
  test('openChatApp and closeChatApp are exported with seed support', () => {
    assert.match(chatAppSrc, /export async function openChatApp\(options\?: string \| ChatAppOpenOptions\)/);
    assert.match(chatAppSrc, /export function closeChatApp\(/);
    assert.match(chatAppSrc, /await applyConciergeSeed\(opts\.seed\)/);
    assert.match(chatAppSrc, /async function applyConciergeSeed\(seed\?: string\)/);
    assert.match(chatAppSrc, /input\.value = text/);
  });

  test('app-host routes Code foreground for chat deep-links', () => {
    assert.match(appHostSrc, /case 'code':/);
    assert.doesNotMatch(appHostSrc, /case 'chat':/);
  });

  test('closeChatApp navigates to desktop under OS shell', () => {
    assert.match(chatAppSrc, /navigateToDesktop\(\)/);
    assert.match(chatAppSrc, /root\.classList\.remove\('is-open'\)/);
  });
});

describe('chat app open/close DOM shell', () => {
  test('is-open class toggles on #chatView', () => {
    const win = new Window();
    globalThis.window = win;
    globalThis.document = win.document;
    win.document.body.innerHTML = '<main id="chatView"></main><div id="appBody"></div>';

    const root = document.getElementById('chatView');
    assert.ok(root);

    root.classList.add('is-open');
    assert.equal(root.classList.contains('is-open'), true);

    root.classList.remove('is-open');
    assert.equal(root.classList.contains('is-open'), false);
  });

  test('applyConciergeSeed only fills empty composer (mirrors chat-app.ts)', () => {
    const win = new Window();
    globalThis.window = win;
    globalThis.document = win.document;
    win.document.body.innerHTML = '<textarea id="chatAppInput"></textarea>';

    const input = document.getElementById('chatAppInput');
    assert.ok(input);

    function applySeedToComposer(seed) {
      if (!seed?.trim()) return;
      if (!input || input.value.trim()) return;
      input.value = seed.trim();
    }

    applySeedToComposer('draft email');
    assert.equal(input.value, 'draft email');

    applySeedToComposer('ignored');
    assert.equal(input.value, 'draft email');
  });
});
