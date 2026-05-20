import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const __dirname = dirname(fileURLToPath(import.meta.url));

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML =
    '<span id="sDot" class="s-dot"></span><span id="sText"></span>';
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (path.includes('/api/workspace/recent') && init?.method === 'DELETE') {
      return {
        ok: true,
        json: async () => ({ ok: true, recent: [] }),
      };
    }
    if (path.includes('/api/workspace')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          path: '/projects/current',
          label: 'current',
          isDefault: false,
          recent: [
            {
              path: '/projects/current',
              label: 'current',
              exists: true,
              isCurrent: true,
            },
            {
              path: '/projects/missing',
              label: 'missing',
              exists: false,
              isCurrent: false,
            },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return window;
}

const {
  closeWorkspaceMenu,
  isWorkspaceMenuOpen,
  renderWorkspaceMenuForTest,
  setWorkspaceMenuDeps,
  toggleWorkspaceMenu,
} = await import('../../src/ui/workspace-recent-menu.ts');

setWorkspaceMenuDeps({
  isServerAvailable: () => true,
  reportStatus: () => {},
});

describe('workspace-recent-menu', { concurrency: false }, () => {
  test('render list marks current row with aria-current', async () => {
    setupDom();
    const menu = document.createElement('ul');
    await renderWorkspaceMenuForTest(menu);

    const current = menu.querySelector('[aria-current="true"]');
    assert.ok(current);
    const check = current.querySelector('.workspace-menu__check');
    assert.equal(check?.textContent, '✓');
  });

  test('missing path row is disabled and does not call setWorkspacePath on click', async () => {
    setupDom();
    let putCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (init?.method === 'PUT') {
        putCalled = true;
      }
      return originalFetch(url, init);
    };

    const menu = document.createElement('ul');
    await renderWorkspaceMenuForTest(menu);
    const disabled = menu.querySelector('.workspace-menu__item--disabled');
    assert.ok(disabled);
    assert.equal(disabled.getAttribute('aria-disabled'), 'true');
    disabled.click();
    assert.equal(putCalled, false);
  });

  test('Escape closes menu and clears aria-expanded', async () => {
    setupDom();
    const btn = document.createElement('button');
    btn.id = 'btnWorkspace';
    document.body.appendChild(btn);

    await toggleWorkspaceMenu(btn);
    assert.equal(isWorkspaceMenuOpen(), true);
    assert.equal(btn.getAttribute('aria-expanded'), 'true');

    const win = document.defaultView;
    document.dispatchEvent(
      new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    assert.equal(isWorkspaceMenuOpen(), false);
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    closeWorkspaceMenu();
  });
});
