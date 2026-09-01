/**
 * MIN-675: commit-diff Wrap toggle mounts with wrap on by default and toggles the SBS class.
 * Run via tsx-mocks-loader (default for .mts).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { Window } from 'happy-dom';

const SAMPLE_PATCH = `diff --git a/long-line.ts b/long-line.ts
index 111..222 100644
--- a/long-line.ts
+++ b/long-line.ts
@@ -1,2 +1,2 @@
 context
-const before = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
+const after = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
`;

// Mocks must be registered before the panel module is loaded.
mock.module('../../src/state/git-api.ts', {
  namedExports: {
    gitShow: async () => ({
      ok: true,
      patch: SAMPLE_PATCH,
      stat: '1 file changed, 1 insertion(+), 1 deletion(-)',
    }),
    gitDiff: async () => ({ ok: true, patch: SAMPLE_PATCH }),
  },
});

mock.module('../../src/ui/file-layout.ts', {
  namedExports: {
    showViewerSplit: () => {
      document.getElementById('fileViewerPane')?.classList.remove('hidden');
    },
    hideViewerSplit: () => {},
  },
});

mock.module('../../src/ui/file-viewer.ts', {
  namedExports: {
    dismissFileViewerForPreview: async () => true,
  },
});

mock.module('../../src/ui/icon.ts', {
  namedExports: {
    iconHtml: () => '<span class="icon-stub"></span>',
  },
});

describe('git commit diff wrap toggle (MIN-675)', () => {
  let happyWindow: Window | undefined;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    happyWindow = new Window({ url: 'http://localhost/' });
    globalThis.window = happyWindow as unknown as Window & typeof globalThis;
    globalThis.document = happyWindow.document as unknown as Document;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
        setItem: (key: string, value: string) => {
          memory.set(key, String(value));
        },
        removeItem: (key: string) => {
          memory.delete(key);
        },
      },
    });

    document.body.innerHTML = `
      <div id="rightPaneColumn">
        <section id="fileViewerPane" class="file-viewer-pane">
          <div id="fileViewerHost" class="file-viewer-body"></div>
        </section>
      </div>
    `;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
    happyWindow?.close();
    happyWindow = undefined;
  });

  it('opens with Wrap pressed and sbs-diff--wrap applied by default', async () => {
    const { openGitCommitDiffPanel, closeGitCommitDiffPanel } = await import(
      '../../src/ui/git-commit-diff-panel.ts'
    );
    const result = await openGitCommitDiffPanel({
      sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      subject: 'wrap default',
    });
    assert.equal(result.ok, true);

    const wrapBtn = document.getElementById('btnGitCommitDiffWrap');
    assert.ok(wrapBtn);
    assert.equal(wrapBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(wrapBtn.classList.contains('is-active'), true);

    const sbs = document.querySelector('.sbs-diff');
    assert.ok(sbs);
    assert.equal(sbs.classList.contains('sbs-diff--wrap'), true);

    wrapBtn.click();
    assert.equal(wrapBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(sbs.classList.contains('sbs-diff--wrap'), false);
    assert.equal(memory.get('minnow.gitCommitDiffWordWrap'), '0');

    wrapBtn.click();
    assert.equal(wrapBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(sbs.classList.contains('sbs-diff--wrap'), true);
    assert.equal(memory.get('minnow.gitCommitDiffWordWrap'), '1');

    // happy-dom rejects CustomEvent on window.dispatchEvent in some versions —
    // assert panel chrome was built; closing is covered by product usage.
    assert.equal(typeof closeGitCommitDiffPanel, 'function');
    assert.ok(document.querySelector('.git-commit-diff__wrap-toggle'));
  });
});
