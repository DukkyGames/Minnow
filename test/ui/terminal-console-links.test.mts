import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  installHappyDomGlobals,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';
import { resetFilePanelStateForTests } from '../../src/state/file-panel.ts';
import {
  appendConsoleOutputWithLinks,
  openConsoleLinkInPreview,
} from '../../src/ui/terminal-console-links.ts';

function setupPreviewDom(): void {
  document.body.innerHTML = `
    <div id="workspaceSplit" class="workspace-split">
      <div class="main-column"></div>
      <div id="splitResizer" class="split-resizer hidden"></div>
      <section id="fileViewerPane" class="file-viewer-pane hidden"></section>
      <section id="previewPane" class="preview-pane hidden"></section>
    </div>
    <aside id="fileSidebar"><button id="btnFileSidebarCollapse" type="button"></button></aside>
    <iframe id="previewFrame"></iframe>
    <input id="previewUrlInput" />
    <div id="previewStatus"></div>
  `;
}

describe('terminal-console-links', () => {
  /** @type {Window | undefined} */
  let win: Window | undefined;

  beforeEach(() => {
    win = new Window({ url: 'http://localhost:9473/' });
    installHappyDomGlobals(win);
    resetFilePanelStateForTests();
    setupPreviewDom();
    window.minnow = {
      preview: {
        hide: () => undefined,
        show: async () => undefined,
        loadURL: async () => undefined,
        navigateAndWait: async () => ({ ok: true }),
        onNavigation: () => () => undefined,
        onLoading: () => () => undefined,
        onLoadFailed: () => () => undefined,
      },
    };
  });

  afterEach(async () => {
    resetFilePanelStateForTests();
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('appendConsoleOutputWithLinks turns URLs into preview anchors', () => {
    const parent = document.createElement('pre');
    appendConsoleOutputWithLinks(parent, 'ready at http://localhost:5173/\n');

    const anchor = parent.querySelector('a.terminal-console-link');
    assert.ok(anchor);
    assert.equal(anchor?.getAttribute('href'), 'http://localhost:5173/');
    assert.equal(anchor?.textContent, 'http://localhost:5173/');
    assert.equal(parent.textContent, 'ready at http://localhost:5173/\n');
  });

  test('appendConsoleOutputWithLinks wraps stderr URLs in stderr-line span', () => {
    const parent = document.createElement('pre');
    appendConsoleOutputWithLinks(parent, 'err https://example.com/path', { stderr: true });

    const stderr = parent.querySelector('.stderr-line');
    assert.ok(stderr);
    const anchor = stderr?.querySelector('a.terminal-console-link');
    assert.equal(anchor?.getAttribute('href'), 'https://example.com/path');
  });

  test('console link click prevents default navigation', async () => {
    const parent = document.createElement('pre');
    appendConsoleOutputWithLinks(parent, 'see http://localhost:3000/app');

    const anchor = parent.querySelector('a.terminal-console-link') as HTMLAnchorElement;
    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    assert.equal(event.defaultPrevented, true);
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  test('openConsoleLinkInPreview ignores empty URLs', async () => {
    let called = false;
    window.minnow = {
      preview: {
        hide: () => undefined,
        show: async () => {
          called = true;
        },
      },
    };

    openConsoleLinkInPreview('   ');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(called, false);
  });
});
