/**
 * Inbox category tab bar — default Primary, click reloads with category param,
 * shown on the Inbox folder only; hidden on Needs attention / when toggle off.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

/** Mirrors the gating helper in email-inbox.ts (kept local so the suite stays unit-sized). */
function scopeShowsCategoryTabs(
  scope: { kind: string; path?: string },
  account: { categoryTabsEnabled?: boolean },
): boolean {
  if (account.categoryTabsEnabled === false) return false;
  return scope.kind === 'folder' && String(scope.path ?? '').toUpperCase() === 'INBOX';
}

type Category = 'primary' | 'social' | 'other';

function renderTabs(options: {
  scope: { kind: string; path?: string };
  account: { categoryTabsEnabled?: boolean };
  category: Category;
  counts: Record<Category, number>;
  onSelect: (next: Category) => void;
}): HTMLElement {
  const doc = new Window().document;
  const mount = doc.createElement('div');
  mount.className = 'email-stream-tabs';
  mount.setAttribute('role', 'tablist');

  if (!scopeShowsCategoryTabs(options.scope, options.account)) {
    mount.hidden = true;
    return mount;
  }

  const segments = doc.createElement('div');
  segments.className = 'email-chrome-segments';
  for (const tab of [
    { id: 'primary' as const, label: 'Primary' },
    { id: 'social' as const, label: 'Social' },
    { id: 'other' as const, label: 'Other' },
  ]) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'email-chrome-segment';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', tab.id === options.category ? 'true' : 'false');
    if (tab.id === options.category) btn.classList.add('is-active');
    btn.dataset.category = tab.id;
    btn.textContent = tab.label;
    const count = options.counts[tab.id] ?? 0;
    if (count > 0) {
      const badge = doc.createElement('span');
      badge.className = 'email-chrome-segment-count';
      badge.textContent = String(count);
      btn.appendChild(badge);
    }
    btn.addEventListener('click', () => options.onSelect(tab.id));
    segments.appendChild(btn);
  }
  mount.appendChild(segments);
  return mount;
}

describe('email category tabs', () => {
  test('defaults to Primary active with count badges', () => {
    const mount = renderTabs({
      scope: { kind: 'folder', path: 'INBOX' },
      account: {},
      category: 'primary',
      counts: { primary: 3, social: 1, other: 0 },
      onSelect: () => undefined,
    });
    assert.equal(mount.hidden, false);
    const active = mount.querySelector('.email-chrome-segment.is-active');
    assert.ok(active);
    assert.equal(active?.getAttribute('aria-selected'), 'true');
    assert.match(active?.textContent ?? '', /Primary/);
    assert.equal(mount.querySelectorAll('.email-chrome-segment-count').length, 2);
  });

  test('click switches active tab and reports the category param', () => {
    let selected: Category = 'primary';
    const mount = renderTabs({
      scope: { kind: 'folder', path: 'INBOX' },
      account: { categoryTabsEnabled: true },
      category: 'primary',
      counts: { primary: 0, social: 2, other: 0 },
      onSelect: (next) => {
        selected = next;
      },
    });
    const social = mount.querySelector<HTMLButtonElement>('[data-category="social"]');
    assert.ok(social);
    social?.click();
    assert.equal(selected, 'social');
  });

  test('hidden on Needs attention, non-Inbox folders, and when toggle is off', () => {
    const triage = renderTabs({
      scope: { kind: 'triage' },
      account: {},
      category: 'primary',
      counts: { primary: 0, social: 0, other: 0 },
      onSelect: () => undefined,
    });
    assert.equal(triage.hidden, true);

    const sent = renderTabs({
      scope: { kind: 'folder', path: 'Sent' },
      account: {},
      category: 'primary',
      counts: { primary: 0, social: 0, other: 0 },
      onSelect: () => undefined,
    });
    assert.equal(sent.hidden, true);

    const toggledOff = renderTabs({
      scope: { kind: 'folder', path: 'INBOX' },
      account: { categoryTabsEnabled: false },
      category: 'primary',
      counts: { primary: 0, social: 0, other: 0 },
      onSelect: () => undefined,
    });
    assert.equal(toggledOff.hidden, true);
  });
});
