import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const {
  isSettingsSearchInMenubar,
  mountSettingsSearchToMenubar,
  unmountSettingsSearchFromMenubar,
} = await import('../../src/os/settings-search-menubar.ts');

function setupDom(): void {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  const menubar = document.createElement('div');
  menubar.id = 'osMenubar';
  const center = document.createElement('div');
  center.id = 'osMenubarCenter';
  center.className = 'mn-os-mb-center';
  const menubarSlot = document.createElement('div');
  menubarSlot.id = 'osMenubarSettingsSearchSlot';
  center.appendChild(menubarSlot);
  menubar.appendChild(center);
  document.body.appendChild(menubar);

  const settingsView = document.createElement('main');
  settingsView.id = 'settingsView';
  settingsView.className = 'settings-page is-open';

  const header = document.createElement('header');
  header.className = 'settings-page-header';

  const homeSlot = document.createElement('div');
  homeSlot.id = 'settingsSearchFinderSlot';
  homeSlot.className = 'settings-search-finder-slot';

  const finder = document.createElement('div');
  finder.id = 'settingsSearchFinder';
  finder.className = 'settings-search-finder';
  const input = document.createElement('input');
  input.id = 'settingsSearchInput';
  finder.appendChild(input);
  homeSlot.appendChild(finder);
  header.appendChild(homeSlot);
  settingsView.appendChild(header);
  document.body.appendChild(settingsView);
}

describe('settings-search-menubar', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test('mount moves finder into menubar slot when OS shell is enabled', () => {
    setupDom();
    mountSettingsSearchToMenubar();
    const finder = document.getElementById('settingsSearchFinder');
    const menubarSlot = document.getElementById('osMenubarSettingsSearchSlot');
    assert.ok(finder && menubarSlot);
    assert.equal(finder.parentElement, menubarSlot);
    assert.equal(isSettingsSearchInMenubar(), true);
    assert.ok(finder.classList.contains('is-in-menubar'));
  });

  test('unmount returns finder to header slot', () => {
    setupDom();
    mountSettingsSearchToMenubar();
    unmountSettingsSearchFromMenubar();
    const finder = document.getElementById('settingsSearchFinder');
    const homeSlot = document.getElementById('settingsSearchFinderSlot');
    const menubarSlot = document.getElementById('osMenubarSettingsSearchSlot');
    assert.ok(finder && homeSlot && menubarSlot);
    assert.equal(finder.parentElement, homeSlot);
    assert.equal(isSettingsSearchInMenubar(), false);
    assert.equal(finder.classList.contains('is-in-menubar'), false);
  });
});
