import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';
import {
  renderPreviewSnapshotTree,
  type PreviewSnapshotNode,
} from '../../src/tools/browser-preview-snapshot.ts';

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
    const mod = await import('../../src/tools/browser-preview-tools.ts');
    assert.equal(mod.isElectronPreviewAvailable(), false);
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
