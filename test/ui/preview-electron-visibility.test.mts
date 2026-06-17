import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import {
  isFullscreenOverlayObscuringWorkspace,
  isPreviewPaneDomVisible,
  shouldShowElectronPreviewHost,
  syncElectronPreviewHostLayout,
} from '../../src/ui/preview-electron-visibility.ts';
import {
  DEFAULT_FILE_PANEL_STATE,
  resetFilePanelStateForTests,
  setFilePanelState,
} from '../../src/state/file-panel.ts';

describe('preview-electron-visibility', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const elements = new Map<string, { classList: Set<string> }>();
  let showCalls = 0;
  let hideCalls = 0;
  let lastBounds: { x: number; y: number; width: number; height: number } | null = null;

  beforeEach(() => {
    elements.clear();
    showCalls = 0;
    hideCalls = 0;
    lastBounds = null;
    resetFilePanelStateForTests();
    Object.defineProperty(globalThis, 'document', {
      value: {
        getElementById: (id: string) => {
          const entry = elements.get(id);
          if (!entry) return null;
          return {
            classList: {
              contains: (cls: string) => entry.classList.has(cls),
              add: (cls: string) => entry.classList.add(cls),
              remove: (cls: string) => entry.classList.delete(cls),
            },
            getBoundingClientRect: () => ({
              left: 10,
              top: 20,
              width: 400,
              height: 300,
            }),
          };
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        minnow: {
          preview: {
            show: async () => {
              showCalls += 1;
            },
            hide: async () => {
              hideCalls += 1;
            },
            setBounds: async (bounds: { x: number; y: number; width: number; height: number }) => {
              lastBounds = bounds;
            },
          },
        },
      },
      configurable: true,
      writable: true,
    });
    elements.set('previewPane', { classList: new Set(['hidden']) });
    elements.set('previewBody', { classList: new Set() });
    elements.set('globalBugsView', { classList: new Set() });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  test('shouldShowElectronPreviewHost is false without minnow bridge', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    assert.equal(shouldShowElectronPreviewHost(), false);
  });

  test('isPreviewPaneDomVisible requires preview mode and visible pane', () => {
    assert.equal(isPreviewPaneDomVisible(), false);
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    assert.equal(isPreviewPaneDomVisible(), false);
    elements.get('previewPane')!.classList.delete('hidden');
    assert.equal(isPreviewPaneDomVisible(), true);
  });

  test('isFullscreenOverlayObscuringWorkspace detects global bugs route', () => {
    assert.equal(isFullscreenOverlayObscuringWorkspace(), false);
    elements.get('globalBugsView')!.classList.add('is-open');
    assert.equal(isFullscreenOverlayObscuringWorkspace(), true);
  });

  test('shouldShowElectronPreviewHost is false when bugs overlay is open', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    elements.get('globalBugsView')!.classList.add('is-open');
    assert.equal(shouldShowElectronPreviewHost(), false);
  });

  test('syncElectronPreviewHostLayout shows then sets bounds when preview pane is open', async () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');

    await syncElectronPreviewHostLayout();

    assert.equal(showCalls, 1);
    assert.equal(hideCalls, 0);
    assert.deepEqual(lastBounds, { x: 10, y: 20, width: 400, height: 300 });
  });

  test('syncElectronPreviewHostLayout hides when preview pane is closed', async () => {
    await syncElectronPreviewHostLayout();
    assert.equal(showCalls, 0);
    assert.equal(hideCalls, 1);
    assert.equal(lastBounds, null);
  });
});
