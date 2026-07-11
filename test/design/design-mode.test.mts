import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  enableDesignMode,
  disableDesignMode,
  isDesignModeEnabled,
  relocateDesignModeStrip,
  resetDesignModeForTests,
} from '../../src/design/design-mode.ts';
import {
  getDesignTool,
  resetDesignToolRegistryForTests,
} from '../../src/design/design-tool.ts';
import { resetDesignMetaCacheForTests } from '../../src/config/design-meta.ts';

describe('design-mode mount/unmount + pointer capture', () => {
  let host: HTMLElement;
  let pane: HTMLElement;

  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    globalThis.ResizeObserver = win.ResizeObserver;
    globalThis.PointerEvent = win.PointerEvent;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;

    pane = document.createElement('div');
    host = document.createElement('div');
    host.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 400,
        height: 300,
        right: 400,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 });
    pane.appendChild(host);
    document.body.appendChild(pane);

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: true, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    resetDesignMetaCacheForTests();
    resetDesignToolRegistryForTests();
    resetDesignModeForTests();
  });

  afterEach(() => {
    resetDesignModeForTests();
    resetDesignToolRegistryForTests();
    resetDesignMetaCacheForTests();
    document.body.innerHTML = '';
  });

  test('enableDesignMode mounts overlay, capture layer and strip into the host', async () => {
    await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });

    assert.equal(isDesignModeEnabled('workspace-preview'), true);
    assert.ok(host.querySelector('svg.mn-design-overlay'));
    assert.ok(host.querySelector('.mn-design-capture'));
    assert.ok(host.querySelector('.mn-design-strip'));
  });

  test('disableDesignMode unmounts everything and leaves the host otherwise empty', async () => {
    await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    disableDesignMode('workspace-preview');

    assert.equal(isDesignModeEnabled('workspace-preview'), false);
    assert.equal(host.querySelector('svg.mn-design-overlay'), null);
    assert.equal(host.querySelector('.mn-design-capture'), null);
    assert.equal(host.querySelector('.mn-design-strip'), null);
  });

  test('capture layer is pointer-events:none until a capture-mode tool is armed', async () => {
    const session = await enableDesignMode({
      instanceId: 'workspace-preview',
      host,
      paneElement: pane,
    });
    const capture = host.querySelector<HTMLElement>('.mn-design-capture')!;
    assert.equal(capture.style.pointerEvents, 'none');

    session.armTool('draw');
    assert.equal(capture.style.pointerEvents, 'auto');

    session.disarmTool();
    assert.equal(capture.style.pointerEvents, 'none');
  });

  test('select is a passthrough tool — the guest keeps receiving clicks for the picker', async () => {
    const session = await enableDesignMode({
      instanceId: 'workspace-preview',
      host,
      paneElement: pane,
    });
    const capture = host.querySelector<HTMLElement>('.mn-design-capture')!;

    session.armTool('select');
    assert.equal(capture.style.pointerEvents, 'none');

    session.armTool('comment');
    assert.equal(capture.style.pointerEvents, 'auto');
  });

  test('armed tool receives pointer events in host-space coordinates', async () => {
    const session = await enableDesignMode({
      instanceId: 'workspace-preview',
      host,
      paneElement: pane,
    });
    session.armTool('draw');

    const events: string[] = [];
    const tool = getDesignTool('draw')!;
    const originalDown = tool.onPointerDown?.bind(tool);
    tool.onPointerDown = (evt) => {
      events.push(`${evt.x},${evt.y}`);
      originalDown?.(evt);
    };

    const capture = host.querySelector<HTMLElement>('.mn-design-capture')!;
    capture.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 40, clientY: 60, bubbles: true }),
    );

    assert.deepEqual(events, ['40,60']);
  });

  test('switching armed tools disarms the previous one', async () => {
    const session = await enableDesignMode({
      instanceId: 'workspace-preview',
      host,
      paneElement: pane,
    });
    session.armTool('select');
    const selectTool = getDesignTool('select')!;
    let selectDisarmed = false;
    const originalDisarm = selectTool.disarm.bind(selectTool);
    selectTool.disarm = () => {
      selectDisarmed = true;
      originalDisarm();
    };

    session.armTool('draw');
    assert.equal(selectDisarmed, true);
    assert.equal(session.getArmedToolId(), 'draw');
  });

  test('toggling Design Mode off then on again re-mounts cleanly', async () => {
    await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    disableDesignMode('workspace-preview');
    await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });

    assert.equal(isDesignModeEnabled('workspace-preview'), true);
    assert.equal(host.querySelectorAll('.mn-design-strip').length, 1);
  });

  test('relocateDesignModeStrip moves the strip between host elements', async () => {
    const chrome = document.createElement('div');
    chrome.className = 'preview-design-chrome';
    pane.appendChild(chrome);
    const session = await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    assert.ok(host.contains(session.strip));

    relocateDesignModeStrip('workspace-preview', chrome);
    assert.ok(chrome.contains(session.strip));
    assert.equal(host.querySelector('.mn-design-strip'), null);
  });
});

describe('design-mode keyboard shortcuts', () => {
  let host: HTMLElement;
  let pane: HTMLElement;
  let outside: HTMLElement;

  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    globalThis.ResizeObserver = win.ResizeObserver;
    globalThis.PointerEvent = win.PointerEvent;
    globalThis.KeyboardEvent = win.KeyboardEvent as unknown as typeof KeyboardEvent;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;

    pane = document.createElement('div');
    host = document.createElement('div');
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 });
    pane.appendChild(host);
    outside = document.createElement('button');
    document.body.appendChild(pane);
    document.body.appendChild(outside);

    globalThis.fetch = (async () => ({ ok: true, json: async () => ({}) }) as Response) as typeof fetch;

    resetDesignMetaCacheForTests();
    resetDesignToolRegistryForTests();
    resetDesignModeForTests();
  });

  afterEach(() => {
    resetDesignModeForTests();
    resetDesignToolRegistryForTests();
    resetDesignMetaCacheForTests();
    document.body.innerHTML = '';
  });

  test('"v" arms select and Escape disarms it, when focus is inside the pane', async () => {
    const session = await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    const focusTarget = document.createElement('button');
    pane.appendChild(focusTarget);
    focusTarget.focus();

    focusTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
    assert.equal(session.getArmedToolId(), 'select');

    focusTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(session.getArmedToolId(), null);
  });

  test('"p" arms draw and "c" arms comment', async () => {
    const session = await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    pane.focus();

    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    assert.equal(session.getArmedToolId(), 'draw');

    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    assert.equal(session.getArmedToolId(), 'comment');
  });

  test('shortcuts are ignored when focus is outside the preview pane', async () => {
    const session = await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    outside.focus();

    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
    assert.equal(session.getArmedToolId(), null);
  });

  test('shortcuts work when nothing is focused (keydown targets <body>)', async () => {
    const session = await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
    assert.equal(session.getArmedToolId(), 'select');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(session.getArmedToolId(), null);
  });
});

describe('design-mode tool strip', () => {
  let host: HTMLElement;
  let pane: HTMLElement;

  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    globalThis.ResizeObserver = win.ResizeObserver;
    globalThis.PointerEvent = win.PointerEvent;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;

    pane = document.createElement('div');
    host = document.createElement('div');
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 });
    pane.appendChild(host);
    document.body.appendChild(pane);

    globalThis.fetch = (async () => ({ ok: true, json: async () => ({}) }) as Response) as typeof fetch;

    resetDesignMetaCacheForTests();
    resetDesignToolRegistryForTests();
    resetDesignModeForTests();
  });

  afterEach(() => {
    resetDesignModeForTests();
    resetDesignToolRegistryForTests();
    resetDesignMetaCacheForTests();
    document.body.innerHTML = '';
  });

  test('strip shows select/draw/comment tool buttons (no dead inspect button)', async () => {
    await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    const toolIds = [...host.querySelectorAll<HTMLButtonElement>('[data-tool]')].map(
      (btn) => btn.dataset.tool,
    );
    assert.deepEqual(toolIds, ['select', 'draw', 'comment']);
  });

  test('strip positioning is CSS-owned (no inline position that overrides the chrome variant)', async () => {
    await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    const strip = host.querySelector<HTMLElement>('.mn-design-strip')!;
    assert.equal(strip.style.position, '');
  });

  test('draw sub-tools are hidden until draw is armed, then reflect the shape kind', async () => {
    const session = await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    const sub = host.querySelector<HTMLElement>('.mn-design-strip__sub')!;
    assert.equal(sub.hidden, true);

    session.armTool('draw');
    assert.equal(sub.hidden, false);
    const pressed = sub.querySelector<HTMLButtonElement>('[data-shape-kind][aria-pressed="true"]');
    assert.equal(pressed?.dataset.shapeKind, 'rect');

    sub.querySelector<HTMLButtonElement>('[data-shape-kind="arrow"]')!.click();
    const nowPressed = sub.querySelector<HTMLButtonElement>('[data-shape-kind][aria-pressed="true"]');
    assert.equal(nowPressed?.dataset.shapeKind, 'arrow');

    session.disarmTool();
    assert.equal(sub.hidden, true);
  });

  test('exit button invokes onExit when provided', async () => {
    let exited = 0;
    await enableDesignMode({
      instanceId: 'workspace-preview',
      host,
      paneElement: pane,
      onExit: () => {
        exited += 1;
      },
    });
    host.querySelector<HTMLButtonElement>('.mn-design-strip__exit')!.click();
    assert.equal(exited, 1);
  });

  test('exit button falls back to disableDesignMode without onExit', async () => {
    await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    host.querySelector<HTMLButtonElement>('.mn-design-strip__exit')!.click();
    assert.equal(isDesignModeEnabled('workspace-preview'), false);
    assert.equal(host.querySelector('.mn-design-strip'), null);
  });

  test('strip includes a Clear all marks button', async () => {
    await enableDesignMode({ instanceId: 'workspace-preview', host, paneElement: pane });
    const clearBtn = host.querySelector<HTMLButtonElement>('.mn-design-strip__clear-all');
    assert.ok(clearBtn);
    assert.equal(clearBtn.title, 'Clear all marks');
  });

  test('Clear all invokes onClearAll after wiping marks', async () => {
    let cleared = 0;
    const session = await enableDesignMode({
      instanceId: 'workspace-preview',
      host,
      paneElement: pane,
      onClearAll: () => {
        cleared += 1;
      },
    });
    await session.clearAll();
    assert.equal(cleared, 1);
  });
});
