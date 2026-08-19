import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import {
  isFullscreenOverlayObscuringWorkspace,
  isProductWikiOverlayVisible,
  isPreviewPaneDomVisible,
  isChromePopoverOpen,
  registerChromePopover,
  unregisterChromePopover,
  resetChromePopoverRegistryForTests,
  resetPreviewGuestVisibilityForTests,
  shouldShowElectronPreviewHost,
  syncElectronPreviewHostLayout,
} from '../../src/ui/preview-electron-visibility.ts';
import {
  DEFAULT_FILE_PANEL_STATE,
  resetFilePanelStateForTests,
  setFilePanelState,
} from '../../src/state/file-panel.ts';
import {
  resetDesignModeIframeGuestForTests,
  setDesignModeUsingIframeGuest,
} from '../../src/ui/preview-design-mode-guest.ts';
import { WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID } from '../../src/ui/preview-design-mode-mount.ts';

describe('preview-electron-visibility', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const elements = new Map<string, { classList: Set<string> }>();
  let showCalls = 0;
  let hideCalls = 0;
  let lastBounds: { x: number; y: number; width: number; height: number } | null = null;
  let lastShowBounds: { x: number; y: number; width: number; height: number } | null = null;

  let layoutSyncRaf = 0;
  const originalRaf = globalThis.requestAnimationFrame;
  const docElDataset: { osApp?: string } = {};

  function enableCodeForeground(): void {
    docElDataset.osApp = 'code';
    elements.get('appBody')!.classList.delete('hidden');
  }

  beforeEach(() => {
    elements.clear();
    docElDataset.osApp = '';
    showCalls = 0;
    hideCalls = 0;
    lastBounds = null;
    lastShowBounds = null;
    layoutSyncRaf = 0;
    resetFilePanelStateForTests();
    resetChromePopoverRegistryForTests();
    resetPreviewGuestVisibilityForTests();
    resetDesignModeIframeGuestForTests();
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      layoutSyncRaf += 1;
      cb(0);
      return layoutSyncRaf;
    }) as typeof requestAnimationFrame;
    Object.defineProperty(globalThis, 'document', {
      value: {
        documentElement: { dataset: docElDataset },
        getElementById: (id: string) => {
          const entry = elements.get(id);
          if (!entry) return null;
          return {
            classList: {
              contains: (cls: string) => entry.classList.has(cls),
              add: (cls: string) => entry.classList.add(cls),
              remove: (cls: string) => entry.classList.delete(cls),
            },
            contains: (child: unknown) =>
              typeof entry.contains === 'function' ? entry.contains(child) : false,
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
            show: async (bounds?: { x: number; y: number; width: number; height: number }) => {
              showCalls += 1;
              lastShowBounds = bounds ?? null;
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
    elements.set('chatArea', {
      classList: new Set<string>(),
      contains: (_child: unknown) => false,
    });
    elements.set('issuesView', { classList: new Set() });
    elements.set('appBody', { classList: new Set(['hidden']) });
  });

  afterEach(() => {
    resetDesignModeIframeGuestForTests();
    globalThis.requestAnimationFrame = originalRaf;
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

  test('isFullscreenOverlayObscuringWorkspace detects Issues app open', () => {
    assert.equal(isFullscreenOverlayObscuringWorkspace(), false);
    elements.get('issuesView')!.classList.add('is-open');
    assert.equal(isFullscreenOverlayObscuringWorkspace(), true);
  });

  test('isProductWikiOverlayVisible detects wiki overlay open', () => {
    assert.equal(isProductWikiOverlayVisible(), false);
    elements.set('productWikiOverlay', { classList: new Set(['hidden']) });
    assert.equal(isProductWikiOverlayVisible(), false);
    elements.get('productWikiOverlay')!.classList.delete('hidden');
    assert.equal(isProductWikiOverlayVisible(), true);
  });

  test('shouldShowElectronPreviewHost is false when product wiki overlay is open', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    enableCodeForeground();
    elements.set('productWikiOverlay', { classList: new Set() });
    assert.equal(shouldShowElectronPreviewHost(), false);
  });

  test('shouldShowElectronPreviewHost is false when Issues app is open', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    elements.get('issuesView')!.classList.add('is-open');
    assert.equal(shouldShowElectronPreviewHost(), false);
  });

  test('isChromePopoverOpen tracks register and unregister', () => {
    assert.equal(isChromePopoverOpen(), false);
    registerChromePopover();
    assert.equal(isChromePopoverOpen(), true);
    unregisterChromePopover();
    assert.equal(isChromePopoverOpen(), false);
  });

  test('shouldShowElectronPreviewHost is true when desktop browser mount is active', () => {
    Object.assign(globalThis.window, {
      minnow: { preview: { show: async () => {}, hide: async () => {} } },
    });
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.set('desktopPreviewMount', { classList: new Set(['is-active']) });
    elements.get('previewPane')!.classList.add('hidden');
    docElDataset.osApp = '';
    assert.equal(shouldShowElectronPreviewHost(), true);
  });

  test('shouldShowElectronPreviewHost is false when Code is not foreground', () => {
    Object.assign(globalThis.window, {
      minnow: { preview: { show: async () => {}, hide: async () => {} } },
    });
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    assert.equal(shouldShowElectronPreviewHost(), false);
    enableCodeForeground();
    assert.equal(shouldShowElectronPreviewHost(), true);
  });

  test('shouldShowElectronPreviewHost is false when chrome popover is open', () => {
    Object.assign(globalThis.window, {
      minnow: { preview: { show: async () => {}, hide: async () => {} } },
    });
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    enableCodeForeground();
    assert.equal(shouldShowElectronPreviewHost(), true);
    registerChromePopover();
    assert.equal(shouldShowElectronPreviewHost(), false);
    unregisterChromePopover();
    assert.equal(shouldShowElectronPreviewHost(), true);
  });

  test('shouldShowElectronPreviewHost is false when Design Mode uses iframe guest', () => {
    Object.assign(globalThis.window, {
      minnow: { preview: { show: async () => {}, hide: async () => {} } },
    });
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    enableCodeForeground();
    assert.equal(shouldShowElectronPreviewHost(), true);

    setDesignModeUsingIframeGuest(WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID, true);
    assert.equal(shouldShowElectronPreviewHost(), false);
  });

  test('syncElectronPreviewHostLayout shows with bounds when preview pane is open', async () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    enableCodeForeground();

    await syncElectronPreviewHostLayout();

    assert.equal(showCalls, 1);
    assert.equal(hideCalls, 0);
    assert.deepEqual(lastShowBounds, { x: 10, y: 20, width: 400, height: 300 });
    assert.equal(lastBounds, null);
  });

  test('shouldShowElectronPreviewHost stays true when a Code stage view is mounted', () => {
    Object.assign(globalThis.window, {
      minnow: { preview: { show: async () => {}, hide: async () => {} } },
    });
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    enableCodeForeground();
    // Overview (and siblings) replace #chatArea only; #previewPane is a sibling.
    elements.set('codeOverviewRoot', { classList: new Set() });
    assert.equal(shouldShowElectronPreviewHost(), true);
  });

  test('syncElectronPreviewHostLayout shows when a Code stage view is mounted beside preview', async () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    enableCodeForeground();
    elements.set('codeOverviewRoot', { classList: new Set() });

    await syncElectronPreviewHostLayout();

    assert.equal(showCalls, 1);
    assert.equal(hideCalls, 0);
    assert.deepEqual(lastShowBounds, { x: 10, y: 20, width: 400, height: 300 });
  });

  test('syncElectronPreviewHostLayout hides when preview pane is closed', async () => {
    await syncElectronPreviewHostLayout();
    assert.equal(showCalls, 0);
    assert.equal(hideCalls, 1);
    assert.equal(lastBounds, null);
  });

  test('syncElectronPreviewHostLayout hides when chrome popover is open', async () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    registerChromePopover();

    await syncElectronPreviewHostLayout();

    assert.equal(showCalls, 0);
    assert.equal(hideCalls, 1);
    assert.equal(lastBounds, null);
  });

  test('syncElectronPreviewHostLayout serializes overlapping syncs and keeps latest bounds', async () => {
    let rectLeft = 100;
    let showInFlight = 0;
    let maxShowInFlight = 0;
    Object.defineProperty(globalThis, 'document', {
      value: {
        documentElement: { dataset: docElDataset },
        getElementById: (id: string) => {
          const entry = elements.get(id);
          if (!entry) return null;
          return {
            classList: {
              contains: (cls: string) => entry.classList.has(cls),
              add: (cls: string) => entry.classList.add(cls),
              remove: (cls: string) => entry.classList.delete(cls),
            },
            contains: (child: unknown) =>
              typeof entry.contains === 'function' ? entry.contains(child) : false,
            getBoundingClientRect: () => ({
              left: rectLeft,
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
            show: async (bounds?: { x: number; y: number; width: number; height: number }) => {
              showInFlight += 1;
              maxShowInFlight = Math.max(maxShowInFlight, showInFlight);
              lastShowBounds = bounds ?? null;
              await new Promise((resolve) => setTimeout(resolve, 5));
              showInFlight -= 1;
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

    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    elements.get('previewPane')!.classList.delete('hidden');
    enableCodeForeground();

    const first = syncElectronPreviewHostLayout();
    await first;

    assert.equal(maxShowInFlight, 1);
    assert.deepEqual(lastShowBounds, { x: 100, y: 20, width: 400, height: 300 });

    rectLeft = 40;
    await syncElectronPreviewHostLayout();

    assert.deepEqual(lastShowBounds, { x: 40, y: 20, width: 400, height: 300 });
    assert.equal(lastBounds, null);
  });
});
