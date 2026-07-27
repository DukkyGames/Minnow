/**
 * Happy-dom surface for headless board E2E — real runChatTurn needs composer DOM ids.
 * Lifted from test/tools/loop-resume.test.mts (installDom).
 */

import { Window } from 'happy-dom';

/** Install global document/window stubs required by runChatTurn. */
export function installHeadlessDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.performance = window.performance;
  globalThis.localStorage = window.localStorage;
  globalThis.window = window as unknown as Window & typeof globalThis;

  const modelSelect = document.createElement('select');
  modelSelect.id = 'modelSelect';
  const opt = document.createElement('option');
  opt.value = 'm1';
  modelSelect.appendChild(opt);
  modelSelect.value = 'm1';
  document.body.appendChild(modelSelect);

  const temperature = document.createElement('input');
  temperature.id = 'temperature';
  temperature.value = '0.7';
  document.body.appendChild(temperature);

  const maxTokens = document.createElement('input');
  maxTokens.id = 'maxTokens';
  maxTokens.value = '512';
  document.body.appendChild(maxTokens);

  const systemPrompt = document.createElement('textarea');
  systemPrompt.id = 'systemPrompt';
  document.body.appendChild(systemPrompt);

  const chatArea = document.createElement('div');
  chatArea.id = 'chatArea';
  document.body.appendChild(chatArea);

  const chatList = document.createElement('div');
  chatList.id = 'chatList';
  document.body.appendChild(chatList);

  const sDot = document.createElement('span');
  sDot.id = 'sDot';
  document.body.appendChild(sDot);
  const sText = document.createElement('span');
  sText.id = 'sText';
  document.body.appendChild(sText);

  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

/** Tear down happy-dom window between tests. */
export function teardownDom(): void {
  if (globalThis.window && typeof globalThis.window.close === 'function') {
    globalThis.window.close();
  }
}
