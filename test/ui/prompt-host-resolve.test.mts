/**
 * Prompt host routing for ask_question / tool approval strips.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
} from '../../src/os/page-bridge.ts';

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="mainColumn">
      <div id="questionHost" class="question-host" hidden></div>
      <div id="toolApprovalHost" class="tool-approval-host" hidden></div>
    </div>
    <main id="chatView" class="chat-app-page">
      <div id="chatAppQuestionHost" class="question-host" hidden></div>
      <div id="chatAppToolApprovalHost" class="tool-approval-host" hidden></div>
    </main>
    <div id="globalQuestionHost" class="question-host question-host--global" hidden></div>
    <div id="globalToolApprovalHost" class="tool-approval-host tool-approval-host--global" hidden></div>
    <div id="desktopComposerRoot" class="mn-os-desktop-composer">
      <div id="desktopQuestionHost" class="question-host" hidden></div>
      <div id="desktopToolApprovalHost" class="tool-approval-host" hidden></div>
    </div>
    <textarea id="desktopInput"></textarea>
    <button id="desktopSendBtn"></button>
    <aside class="email-assistant-dock is-open" aria-hidden="false">
      <div id="emailAssistantQuestionHost" class="question-host" hidden></div>
      <div id="emailAssistantToolApprovalHost" class="tool-approval-host" hidden></div>
      <footer class="email-assistant-composer"></footer>
    </aside>
  `;
}

describe('prompt-host-resolve', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    setupDom(win);
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();
  });

  afterEach(() => {
    resetInstancesForTests();
    resetOsPageBridgeForTests();
  });

  test('Code foreground routes ask_question to main column host', async () => {
    const { resolveQuestionHost } = await import('../../src/ui/prompt-host-resolve.ts');
    launchInstance('code');

    const host = resolveQuestionHost();
    assert.equal(host?.id, 'questionHost');
  });

  test('legacy chat app routes ask_question to chat app host when open', async () => {
    const { resolveQuestionHost } = await import('../../src/ui/prompt-host-resolve.ts');
    document.getElementById('chatView')?.classList.add('is-open');

    const host = resolveQuestionHost();
    assert.equal(host?.id, 'chatAppQuestionHost');
  });

  test('hidden chat app shell is not chosen during desktop chat', async () => {
    const { resolveQuestionHost } = await import('../../src/ui/prompt-host-resolve.ts');

    const host = resolveQuestionHost();
    assert.notEqual(host?.id, 'chatAppQuestionHost');
  });

  test('Brain foreground falls back to global question host', async () => {
    launchInstance('brain');
    const { resolveQuestionHost } = await import('../../src/ui/prompt-host-resolve.ts');

    const host = resolveQuestionHost();
    assert.equal(host?.id, 'globalQuestionHost');
  });
});
