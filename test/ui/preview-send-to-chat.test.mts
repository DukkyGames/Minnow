/**
 * Preview context-menu Send to chat → elementRef composer chip.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';

function setupDom(): void {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
  globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  // toast.ts uses rAF; happy-dom Window may not expose it on globalThis.
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);

  const preview = document.createElement('div');
  preview.id = 'attachPreview';
  preview.className = 'hidden';
  document.body.appendChild(preview);

  const body = document.createElement('div');
  body.id = 'previewBody';
  document.body.appendChild(body);
}

afterEach(async () => {
  const { clearAttachments } = await import('../../src/attachments/store.ts');
  clearAttachments();
  const { resetPreviewContextMenuHandlerForTests } = await import(
    '../../src/ui/preview-context-menu-handler.ts'
  );
  resetPreviewContextMenuHandlerForTests();
  const { resetRegionCaptureForTests } = await import('../../src/design/region-capture.ts');
  resetRegionCaptureForTests();
});

describe('preview-context-menu send to chat', () => {
  it('resolves via IPC hooks and pushes an elementRef chip', async () => {
    setupDom();
    const {
      sendToChatFromContextMenuForTests,
      setPreviewContextMenuHandlerHooks,
    } = await import('../../src/ui/preview-context-menu-handler.ts');
    const { getPendingAttachments } = await import('../../src/attachments/store.ts');

    let resolveArgs: unknown[] | null = null;
    setPreviewContextMenuHandlerHooks({
      resolveElement: async (tabId, x, y, instanceId) => {
        resolveArgs = [tabId, x, y, instanceId];
        return {
          ok: true,
          pageUrl: 'https://example.com/pricing',
          picked: {
            uid: 3,
            cssSelector: 'button.cta',
            tagName: 'button',
            classList: ['cta'],
            outerHTMLPreview: '<button class="cta">Buy</button>',
            boundingRect: { x: 10, y: 20, width: 80, height: 32 },
            devicePixelRatio: 1,
            stylesDigest: 'font:14px',
            accessibleName: 'Buy',
            contrastRatio: 4.5,
            domPath: 'button.cta',
            attributes: { class: 'cta' },
            computedStyles: { color: 'rgb(0, 0, 0)' },
          },
        };
      },
      captureRegion: async () => ({
        selector: 'button.cta',
        boundingRect: { x: 10, y: 20, width: 80, height: 32 },
        devicePixelRatio: 1,
        cropped: true,
        dataUrl: 'data:image/png;base64,aaa',
      }),
    });

    await sendToChatFromContextMenuForTests({
      tabId: 'tab-1',
      instanceId: 'workspace-preview',
      x: 40,
      y: 50,
      params: {},
      items: [],
      canGoBack: false,
      canGoForward: false,
      pageUrl: 'https://example.com/pricing',
    });

    assert.deepEqual(resolveArgs, ['tab-1', 40, 50, 'workspace-preview']);
    const pending = getPendingAttachments();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.kind, 'elementRef');
    assert.equal(pending[0]?.selector, 'button.cta');
    assert.equal(pending[0]?.uid, 3);
    assert.equal(pending[0]?.pageUrl, 'https://example.com/pricing');
    assert.equal(pending[0]?.croppedDataUrl, 'data:image/png;base64,aaa');
  });

  it('does not push a chip when resolve fails', async () => {
    setupDom();
    const {
      sendToChatFromContextMenuForTests,
      setPreviewContextMenuHandlerHooks,
    } = await import('../../src/ui/preview-context-menu-handler.ts');
    const { getPendingAttachments } = await import('../../src/attachments/store.ts');

    setPreviewContextMenuHandlerHooks({
      resolveElement: async () => ({ ok: false, error: 'guest mid-navigation' }),
    });

    await sendToChatFromContextMenuForTests({
      tabId: 'tab-1',
      instanceId: 'workspace-preview',
      x: 1,
      y: 1,
      params: {},
      items: [],
      canGoBack: false,
      canGoForward: false,
      pageUrl: 'https://example.com',
    });

    assert.equal(getPendingAttachments().length, 0);
  });
});
