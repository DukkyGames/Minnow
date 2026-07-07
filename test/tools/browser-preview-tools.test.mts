import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import {
  PREVIEW_DOM_SNAPSHOT_SCRIPT,
  renderPreviewSnapshotTree,
  type PreviewSnapshotNode,
} from '../../src/tools/browser-preview-snapshot.ts';

function metaFetchResponse(): Response {
  return new Response(
    JSON.stringify({
      browser: {
        enabled: true,
        allowNavigate: true,
        allowedOriginPatterns: ['http://localhost:*'],
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function mockElectronPreview(execJs: (script: string) => Promise<unknown>): void {
  Object.defineProperty(globalThis, 'window', {
    value: {
      minnow: {
        app: { isElectron: true, platform: 'linux', openExternal: async () => {} },
        preview: {
          execJs,
          getInfo: async () => ({ url: '', title: '', loading: false }),
          capturePage: async () => '',
          navigateAndWait: async () => ({ ok: true, url: '', title: '' }),
          show: async () => {},
        },
      },
    },
    configurable: true,
    writable: true,
  });
}

describe('browser-preview-snapshot', () => {
  test('renderPreviewSnapshotTree formats uid role name tree', () => {
    const nodes: PreviewSnapshotNode[] = [
      {
        uid: 1,
        role: 'link',
        name: 'Home',
        children: [{ uid: 2, role: 'button', name: 'Go' }],
      },
    ];
    const text = renderPreviewSnapshotTree(nodes);
    assert.match(text, /\[1\] link "Home"/);
    assert.match(text, /\[2\] button "Go"/);
  });

  test('renderPreviewSnapshotTree recurses through uid-0 wrapper nodes', () => {
    const nodes: PreviewSnapshotNode[] = [
      {
        uid: 0,
        role: 'generic',
        name: '',
        children: [
          { uid: 1, role: 'link', name: 'Home' },
          { uid: 2, role: 'button', name: 'Go' },
        ],
      },
    ];
    const text = renderPreviewSnapshotTree(nodes);
    assert.match(text, /\[1\] link "Home"/);
    assert.match(text, /\[2\] button "Go"/);
    assert.doesNotMatch(text, /\[0\]/);
  });

  test('PREVIEW_DOM_SNAPSHOT_SCRIPT stamps uids on SPA-shaped DOM', () => {
    const win = new Window();
    win.document.body.innerHTML =
      '<div id="root"><header><a href="/">Home</a></header><main><button>Go</button></main></div>';

    const result = win.eval(PREVIEW_DOM_SNAPSHOT_SCRIPT) as {
      text: string;
      nodes: PreviewSnapshotNode[];
    };

    assert.match(result.text, /\[1\]/);
    assert.match(result.text, /\[2\]/);
    assert.doesNotMatch(result.text, /\(empty page\)/);
    assert.match(result.text, /link "Home"/);
    assert.match(result.text, /button "Go"/);

    const home = win.document.querySelector('a[href="/"]');
    const go = win.document.querySelector('button');
    assert.equal(home?.getAttribute('data-mn-uid'), '1');
    assert.equal(go?.getAttribute('data-mn-uid'), '2');

    win.close();
  });
});

describe('browser-preview-tools', () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    globalThis.fetch = originalFetch;
  });

  test('isElectronPreviewAvailable is false without minnow bridge', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });
    const shell = await import('../../src/tools/minnow-shell.ts');
    assert.equal(shell.isElectronPreviewAvailable(), false);
  });

  test('executeBrowserPreviewTool returns desktop shell message outside Electron', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });
    const mod = await import('../../src/tools/browser-preview-tools.ts');
    const result = await mod.executeBrowserPreviewTool('browser_list', {});
    assert.match(
      result.content,
      /Error: Browser automation runs in the Minnow desktop shell/,
    );
  });

  test('browser_list_tabs alias lists tabs with active marker', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/config/meta')) return metaFetchResponse();
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    Object.defineProperty(globalThis, 'window', {
      value: {
        minnow: {
          app: { isElectron: true, platform: 'linux', openExternal: async () => {} },
          preview: {
            tabs: {
              list: async () => [
                { id: 'a', title: 'One', url: 'https://one.test', loading: false, active: false },
                { id: 'b', title: 'Two', url: 'https://two.test', loading: false, active: true },
              ],
            },
            execJs: async () => ({}),
            getInfo: async () => ({ url: '', title: '', loading: false }),
            capturePage: async () => '',
            navigateAndWait: async () => ({ ok: true, url: '', title: '' }),
            show: async () => {},
          },
        },
      },
      configurable: true,
      writable: true,
    });

    const mod = await import('../../src/tools/browser-preview-tools.ts');
    const result = await mod.executeBrowserPreviewTool('browser_list_tabs', {});
    assert.match(result.content ?? '', /\[active\] Two/);
    assert.match(result.content ?? '', /id: b/);
    assert.match(result.content ?? '', /One/);
  });

  test('browser_snapshot prefers uid tree when guest text is empty page', async () => {
    let execCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/config/meta')) return metaFetchResponse();
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    mockElectronPreview(async (script) => {
      execCalls++;
      if (script.includes('nextUid')) {
        return {
          text: '(empty page)',
          nodes: [
            {
              uid: 0,
              role: 'generic',
              name: '',
              children: [
                { uid: 1, role: 'link', name: 'Home' },
                { uid: 2, role: 'button', name: 'Go' },
              ],
            },
          ],
        };
      }
      return 'LM-STUDIO // TERMINAL v0.1.0';
    });

    const mod = await import('../../src/tools/browser-preview-tools.ts');
    const result = await mod.executeBrowserPreviewTool('browser_snapshot', {});
    assert.match(result.content ?? '', /\[1\] link "Home"/);
    assert.match(result.content ?? '', /\[2\] button "Go"/);
    assert.doesNotMatch(result.content ?? '', /LM-STUDIO/);
    assert.equal(execCalls, 1);
  });

  test('browser_snapshot returns exec error from guest script', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/config/meta')) return metaFetchResponse();
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    mockElectronPreview(async () => ({ __execError: 'DOM access denied' }));

    const mod = await import('../../src/tools/browser-preview-tools.ts');
    const result = await mod.executeBrowserPreviewTool('browser_snapshot', {});
    assert.match(result.content ?? '', /Error: DOM access denied/);
  });

  test('browser_snapshot returns hint when no interactive elements found', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/config/meta')) return metaFetchResponse();
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    mockElectronPreview(async () => ({ text: '(empty page)', nodes: [] }));

    const mod = await import('../../src/tools/browser-preview-tools.ts');
    const result = await mod.executeBrowserPreviewTool('browser_snapshot', {});
    assert.match(result.content ?? '', /no interactive elements/i);
  });

  test('browser_click reports missing uid when element not found', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/config/meta')) {
        return new Response(
          JSON.stringify({
            browser: {
              enabled: true,
              allowNavigate: true,
              allowedOriginPatterns: ['http://localhost:*'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    Object.defineProperty(globalThis, 'window', {
      value: {
        minnow: {
          app: { isElectron: true, platform: 'linux', openExternal: async () => {} },
          preview: {
            execJs: async () => ({ missing: true }),
            getInfo: async () => ({ url: '', title: '', loading: false }),
            capturePage: async () => '',
            navigateAndWait: async () => ({ ok: true, url: '', title: '' }),
            show: async () => {},
          },
        },
      },
      configurable: true,
      writable: true,
    });

    const shell = await import('../../src/tools/minnow-shell.ts');
    assert.equal(shell.isElectronPreviewAvailable(), true);

    const mod = await import('../../src/tools/browser-preview-tools.ts');
    const result = await mod.executeBrowserPreviewTool('browser_click', { uid: 9 });
    assert.match(result.content, /No snapshot cached/);
  });

  test('browser_screenshot POSTs base64 and returns attachment', async () => {
    const uploads: { body: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/config/meta')) {
        return new Response(
          JSON.stringify({
            browser: {
              enabled: true,
              allowNavigate: true,
              allowedOriginPatterns: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/browser/screenshot' && init?.method === 'POST') {
        uploads.push({ body: String(init.body) });
        return new Response(JSON.stringify({ id: 'shot1', sizeBytes: 2048 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    Object.defineProperty(globalThis, 'window', {
      value: {
        minnow: {
          app: { isElectron: true, platform: 'linux', openExternal: async () => {} },
          preview: {
            execJs: async () => ({}),
            capturePage: async () => Buffer.from('png').toString('base64'),
            getInfo: async () => ({ url: 'http://localhost/', title: 't', loading: false }),
            navigateAndWait: async () => ({ ok: true, url: '', title: '' }),
            show: async () => {},
          },
        },
      },
      configurable: true,
      writable: true,
    });

    const mod = await import('../../src/tools/browser-preview-tools.ts');
    const result = await mod.executeBrowserPreviewTool('browser_screenshot', {});
    assert.equal(uploads.length, 1);
    assert.match(result.content ?? '', /shot1\.png/);
    assert.equal(result.attachments?.[0]?.url, '/api/browser/screenshot/shot1');
    assert.equal(result.attachments?.[0]?.mime, 'image/png');
  });
});
