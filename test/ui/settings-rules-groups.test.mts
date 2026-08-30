/**
 * Settings → Rules group delete: empty groups leave, non-empty groups are blocked.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import { setStorageModeForTests } from '../../src/config/storage-mode.ts';
import { resetUserRulesCache } from '../../src/config/user-rules.ts';

const USER_RULES_STORAGE_KEY = 'minnow.userRules';
const originalFetch = globalThis.fetch;

let domWindow: Window | null = null;

const GENERAL_RULE = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'TypeScript',
  text: 'Use strict TypeScript.',
  enabled: true,
  groupId: 'general',
};

function seedRules(payload: unknown): void {
  localStorage.setItem(USER_RULES_STORAGE_KEY, JSON.stringify(payload));
  resetUserRulesCache();
}

function setupDom(): HTMLElement {
  const window = new Window({ url: 'http://localhost/' });
  domWindow = window;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.SVGElement = window.SVGElement;
  globalThis.localStorage = window.localStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof requestAnimationFrame;

  document.body.innerHTML = '<div id="settingsRulesBody"></div>';
  const mount = document.getElementById('settingsRulesBody');
  assert.ok(mount);
  return mount;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('timed out waiting for condition');
}

function groupTitles(root: ParentNode): string[] {
  return [...root.querySelectorAll('.settings-rules-group__title')].map(
    (node) => node.textContent ?? '',
  );
}

function deleteGroupButton(root: ParentNode, groupName: string): HTMLButtonElement {
  const btn = [...root.querySelectorAll('button')].find(
    (node) => (node.getAttribute('aria-label') ?? '') === `Delete group ${groupName}`,
  );
  assert.ok(btn, `missing Delete group ${groupName}`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  setStorageModeForTests('localStorage');
  globalThis.fetch = async () =>
    ({
      ok: false,
      json: async () => ({}),
    }) as Response;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  resetUserRulesCache();
  setStorageModeForTests(null);
  const { resetAppDialogForTests } = await import('../../src/ui/app-dialog.ts');
  resetAppDialogForTests();
  domWindow?.close();
  domWindow = null;
});

describe('Settings → Rules group delete', () => {
  test('deletes an empty group and keeps it gone after a fresh render', async () => {
    const mount = setupDom();
    seedRules({
      version: 2,
      enabled: true,
      groups: [
        { id: 'general', name: 'General' },
        { id: 'style', name: 'Style' },
      ],
      rules: [GENERAL_RULE],
    });

    const { renderRulesSettingsSection } = await import('../../src/ui/settings-rules.ts');
    await renderRulesSettingsSection(mount, () => {});

    assert.deepEqual(groupTitles(mount), ['General', 'Style']);
    deleteGroupButton(mount, 'Style').click();

    await waitFor(() => Boolean(document.querySelector('[data-dialog-action="confirm"]')));
    document.querySelector<HTMLButtonElement>('[data-dialog-action="confirm"]')?.click();

    await waitFor(() => groupTitles(mount).join(',') === 'General');
    assert.equal(groupTitles(mount).includes('Style'), false);
    assert.match(mount.textContent ?? '', /TypeScript/);
    assert.equal(mount.querySelector('[aria-label="Delete group General"]'), null);

    const stored = JSON.parse(String(localStorage.getItem(USER_RULES_STORAGE_KEY)));
    assert.deepEqual(
      stored.groups.map((group: { id: string }) => group.id),
      ['general'],
    );
    assert.deepEqual(
      stored.rules.map((rule: { id: string; groupId: string }) => ({
        id: rule.id,
        groupId: rule.groupId,
      })),
      [{ id: GENERAL_RULE.id, groupId: 'general' }],
    );

    resetUserRulesCache();
    await renderRulesSettingsSection(mount, () => {});
    assert.deepEqual(groupTitles(mount), ['General']);
    assert.match(mount.textContent ?? '', /TypeScript/);
  });

  test('refuses to delete a group that still has rules and says why', async () => {
    const mount = setupDom();
    seedRules({
      version: 2,
      enabled: true,
      groups: [
        { id: 'general', name: 'General' },
        { id: 'style', name: 'Style' },
      ],
      rules: [
        GENERAL_RULE,
        {
          id: '22222222-2222-2222-2222-222222222222',
          title: 'Diff size',
          text: 'Prefer small diffs.',
          enabled: true,
          groupId: 'style',
        },
      ],
    });

    let lastStatus = '';
    const { renderRulesSettingsSection } = await import('../../src/ui/settings-rules.ts');
    await renderRulesSettingsSection(mount, (_kind, message) => {
      lastStatus = message;
    });

    deleteGroupButton(mount, 'Style').click();

    await waitFor(() => Boolean(document.querySelector('#appDialogPanel')));
    const dialog = document.querySelector('#appDialogPanel');
    assert.match(
      dialog?.textContent ?? '',
      /Cannot delete "Style": it still has 1 rule\. Move or delete it first\./,
    );
    document.querySelector<HTMLButtonElement>('[data-dialog-action="ok"]')?.click();

    await waitFor(() => lastStatus.includes('still has 1 rule'));
    assert.deepEqual(groupTitles(mount), ['General', 'Style']);
    assert.match(mount.textContent ?? '', /Diff size/);
    assert.match(mount.textContent ?? '', /TypeScript/);
  });
});
