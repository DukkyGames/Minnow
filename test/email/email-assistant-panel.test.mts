/**
 * Email assistant dock DOM lifecycle without starting a model or mail server.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import type { EmailAccount } from '../../src/email/client.ts';

const ACCOUNT: EmailAccount = {
  id: 'account-1',
  label: 'Work',
  imap: { host: 'imap.example.com', port: 993, tls: true },
  username: 'me@example.com',
  isDefault: true,
  pollingEnabled: true,
  pollingIntervalMinutes: 15,
  folders: ['INBOX'],
};

let window: Window;

beforeEach(() => {
  window = new Window({ url: 'http://localhost/#/app/email' });
  const globals = globalThis as typeof globalThis & {
    window: Window;
    document: Document;
    HTMLElement: typeof HTMLElement;
    HTMLTextAreaElement: typeof HTMLTextAreaElement;
    Node: typeof Node;
    localStorage: Storage;
    requestAnimationFrame: typeof requestAnimationFrame;
  };
  globals.window = window as unknown as Window & typeof globalThis.window;
  globals.document = window.document as unknown as Document;
  globals.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
  globals.HTMLTextAreaElement =
    window.HTMLTextAreaElement as unknown as typeof HTMLTextAreaElement;
  globals.Node = window.Node as unknown as typeof Node;
  globals.localStorage = window.localStorage as unknown as Storage;
  globals.requestAnimationFrame = (callback) => {
    callback(0);
    return 1;
  };
  document.body.innerHTML =
    '<input id="fileInput" type="file"><div id="email-root"></div>';
});

afterEach(() => {
  window.close();
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'HTMLTextAreaElement',
    'Node',
    'localStorage',
    'requestAnimationFrame',
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

describe('Email assistant panel', () => {
  test('mounts closed with shared chat hosts and updates its context label', async () => {
    const { mountEmailAssistantPanel } = await import(
      '../../src/ui/email/email-assistant-panel.ts'
    );
    const root = document.getElementById('email-root');
    assert.ok(root);
    const shell = document.createElement('div');
    shell.className = 'email-shell-a';
    const workspace = document.createElement('div');
    workspace.className = 'email-workspace';
    shell.appendChild(workspace);
    root.appendChild(shell);

    const controller = mountEmailAssistantPanel(shell, workspace, {
      account: ACCOUNT,
      context: {
        accountId: ACCOUNT.id,
        accountLabel: ACCOUNT.label,
        view: 'Needs attention',
        folder: 'INBOX',
      },
    });

    const dock = shell.querySelector<HTMLElement>('.email-assistant-dock');
    const toggle = workspace.querySelector<HTMLButtonElement>('.email-assistant-toggle');
    assert.ok(dock);
    assert.ok(toggle);
    assert.equal(controller.isOpen(), false);
    assert.equal(dock.getAttribute('aria-hidden'), 'true');
    assert.ok(dock.querySelector('#emailAssistantMessageCol'));
    assert.ok(dock.querySelector('#emailAssistantToolApprovalHost'));
    assert.ok(dock.querySelector('#emailAssistantQuestionHost'));
    assert.ok(dock.querySelector('#emailAssistantAttachPreview'));

    controller.setContext({
      accountId: ACCOUNT.id,
      accountLabel: ACCOUNT.label,
      view: 'Inbox',
      folder: 'INBOX',
      threadId: 'thread-7',
      threadSubject: 'Q3 renewal',
      messageId: 'message-9',
    });
    assert.equal(
      dock.querySelector('.email-assistant-context')?.textContent,
      'Work · Inbox · Q3 renewal',
    );

    controller.dispose();
    assert.equal(document.querySelector('.email-assistant-history'), null);
  });
});
