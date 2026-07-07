import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  enableDesignMode,
  disableDesignMode,
  isDesignModeEnabled,
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

  test('capture layer is pointer-events:none until a tool is armed (pass-through)', async () => {
    const session = await enableDesignMode({
      instanceId: 'workspace-preview',
      host,
      paneElement: pane,
    });
    const capture = host.querySelector<HTMLElement>('.mn-design-capture')!;
    assert.equal(capture.style.pointerEvents, 'none');

    session.armTool('select');
    assert.equal(capture.style.pointerEvents, 'auto');

    session.disarmTool();
    assert.equal(capture.style.pointerEvents, 'none');
  });

  test('armed tool receives pointer events in host-space coordinates', async () => {
    const session = await enableDesignMode({
      instanceId: 'workspace-preview',
      host,
      paneElement: pane,
    });
    session.armTool('select');

    const events: string[] = [];
    const tool = getDesignTool('select')!;
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
});
