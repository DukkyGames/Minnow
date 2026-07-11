/**
 * Real Draw & Comment tools (MIN-367): pointer-driven shape/pin creation, anchor resolution,
 * overlay rendering, per-page persistence (annotation-store.ts, mocked fetch), and the
 * designRef composer chip a finished draw shape produces. Mirrors select-tool.test.mts.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  createDrawDesignTool,
  createCommentDesignTool,
  createSelectDesignTool,
  clearAllDesignModeMarks,
  registerDesignTool,
  type DesignToolContext,
  type CommentDesignTool,
  type DrawDesignTool,
} from '../../src/design/design-tool.ts';
import { createAnnotationOverlay } from '../../src/design/overlay.ts';
import { resetRegionCaptureForTests, setRegionCaptureTestHooks } from '../../src/design/region-capture.ts';
import { resetAnnotationStoreForTests } from '../../src/design/annotation-store.ts';
import { clearAttachments, getPendingAttachments } from '../../src/attachments/store.ts';
import { DEFAULT_FILE_PANEL_STATE, resetFilePanelStateForTests, setFilePanelState } from '../../src/state/file-panel.ts';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Draw & Comment design tools (MIN-367)', () => {
  let host: HTMLElement;
  let putBodies: Array<{ page: string; annotations: unknown }>;

  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    globalThis.ResizeObserver = win.ResizeObserver;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.Image = win.Image;
    Object.assign(globalThis.window, { location: { origin: 'http://127.0.0.1:5173' }, minnow: undefined });

    host = document.createElement('div');
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 });
    document.body.appendChild(host);

    resetFilePanelStateForTests();
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'workspace', path: 'pricing.html' },
    });

    resetRegionCaptureForTests();
    setRegionCaptureTestHooks({
      capturePage: async () => TINY_PNG_BASE64,
      scrollIntoView: async () => {},
      getPageDimensions: async () => ({ pageW: 400, pageH: 300 }),
      cropPngToDataUrl: async () => ({ dataUrl: 'data:image/png;base64,CROPPED' }),
      compositeOverlay: async () => ({ dataUrl: 'data:image/png;base64,COMPOSITED' }),
    });

    putBodies = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        putBodies.push(body);
        return { ok: true, json: async () => ({ ok: true, data: body.annotations }) } as Response;
      }
      return { ok: true, json: async () => ({ shapes: [], pins: [] }) } as Response;
    }) as typeof fetch;

    resetAnnotationStoreForTests();
  });

  afterEach(() => {
    clearAttachments();
    resetRegionCaptureForTests();
    resetFilePanelStateForTests();
    resetAnnotationStoreForTests();
    document.body.innerHTML = '';
  });

  function makeCtx(): DesignToolContext {
    return { instanceId: 'workspace-preview', host, overlay: createAnnotationOverlay({ host }) };
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  test('id/label match the strip button contract', () => {
    const draw = createDrawDesignTool();
    const comment = createCommentDesignTool();
    assert.equal(draw.id, 'draw');
    assert.equal(draw.label, 'Draw');
    assert.equal(comment.id, 'comment');
    assert.equal(comment.label, 'Comment');
  });

  test('default kind is rect; drawing a rect pushes a designRef chip anchored to the page', async () => {
    const draw = createDrawDesignTool();
    const ctx = makeCtx();
    draw.arm(ctx);
    await flush();

    assert.equal(draw.getShapeKind(), 'rect');
    draw.onPointerDown?.({ x: 10, y: 10, raw: {} as PointerEvent });
    draw.onPointerUp?.({ x: 60, y: 50, raw: {} as PointerEvent });
    await flush();

    const shapes = draw.getShapes();
    assert.equal(shapes.length, 1);
    assert.equal(shapes[0]?.kind, 'rect');
    assert.deepEqual(shapes[0]?.rect, { x: 10, y: 10, width: 50, height: 40 });
    assert.equal(shapes[0]?.anchor.type, 'page');

    const pending = getPendingAttachments();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, 'designRef');
    assert.equal(pending[0].pageUrl, 'pricing.html');
    assert.equal(pending[0].compositedDataUrl, 'data:image/png;base64,COMPOSITED');
    assert.equal(pending[0].intentText, 'rect at 10,10 50×40 = region of interest');

    // shape got persisted (annotation-store PUT).
    assert.equal(putBodies.length, 1);
    assert.equal(putBodies[0]?.page, 'pricing.html');

    draw.disarm();
  });

  test('a tiny drag (< 4px) is ignored — no accidental shapes from a plain click', async () => {
    const draw = createDrawDesignTool();
    const ctx = makeCtx();
    draw.arm(ctx);
    await flush();

    draw.onPointerDown?.({ x: 10, y: 10, raw: {} as PointerEvent });
    draw.onPointerUp?.({ x: 11, y: 11, raw: {} as PointerEvent });
    await flush();

    assert.equal(draw.getShapes().length, 0);
    assert.equal(getPendingAttachments().length, 0);
    draw.disarm();
  });

  test('setShapeKind(arrow) produces a move/motion intent chip', async () => {
    const draw = createDrawDesignTool();
    const ctx = makeCtx();
    draw.arm(ctx);
    await flush();
    draw.setShapeKind('arrow');

    draw.onPointerDown?.({ x: 5, y: 5, raw: {} as PointerEvent });
    draw.onPointerUp?.({ x: 95, y: 15, raw: {} as PointerEvent });
    await flush();

    const shapes = draw.getShapes();
    assert.equal(shapes.length, 1);
    assert.equal(shapes[0]?.kind, 'arrow');
    assert.deepEqual(shapes[0]?.points, [
      { x: 5, y: 5 },
      { x: 95, y: 15 },
    ]);

    const pending = getPendingAttachments();
    assert.equal(pending[0].intentText, 'arrow from 5,5 to 95,15 = move/motion intent');
    draw.disarm();
  });

  test('setShapeKind(pen) accumulates + thins a freehand stroke', async () => {
    const draw = createDrawDesignTool();
    const ctx = makeCtx();
    draw.arm(ctx);
    await flush();
    draw.setShapeKind('pen');

    draw.onPointerDown?.({ x: 0, y: 0, raw: {} as PointerEvent });
    for (let i = 1; i <= 20; i += 1) {
      draw.onPointerMove?.({ x: i, y: 0, raw: {} as PointerEvent });
    }
    draw.onPointerUp?.({ x: 20, y: 0, raw: {} as PointerEvent });
    await flush();

    const shapes = draw.getShapes();
    assert.equal(shapes.length, 1);
    assert.equal(shapes[0]?.kind, 'pen');
    assert.ok((shapes[0]?.points?.length ?? 0) >= 2);
    assert.ok((shapes[0]?.points?.length ?? 0) < 21, 'thinning should drop some intermediate points');
    draw.disarm();
  });

  test('eraseShape removes the shape from the overlay and persists the erasure', async () => {
    const draw = createDrawDesignTool();
    const ctx = makeCtx();
    draw.arm(ctx);
    await flush();

    draw.onPointerDown?.({ x: 10, y: 10, raw: {} as PointerEvent });
    draw.onPointerUp?.({ x: 60, y: 50, raw: {} as PointerEvent });
    await flush();
    const shapeId = draw.getShapes()[0]?.id;
    assert.ok(shapeId);

    draw.eraseShape(shapeId!);
    await flush();
    assert.equal(draw.getShapes().length, 0);
    assert.equal(putBodies[putBodies.length - 1]?.annotations.shapes.length, 0);
    draw.disarm();
  });

  test('undo restores the previous shape list via the per-page undo stack', async () => {
    const draw = createDrawDesignTool();
    const ctx = makeCtx();
    draw.arm(ctx);
    await flush();

    draw.onPointerDown?.({ x: 10, y: 10, raw: {} as PointerEvent });
    draw.onPointerUp?.({ x: 60, y: 50, raw: {} as PointerEvent });
    await flush();
    draw.onPointerDown?.({ x: 100, y: 100, raw: {} as PointerEvent });
    draw.onPointerUp?.({ x: 150, y: 150, raw: {} as PointerEvent });
    await flush();
    assert.equal(draw.getShapes().length, 2);

    draw.undo();
    await flush();
    assert.equal(draw.getShapes().length, 1);
    draw.disarm();
  });

  test('disarm clears the shape overlay layer', async () => {
    const draw = createDrawDesignTool();
    const ctx = makeCtx();
    draw.arm(ctx);
    await flush();

    draw.onPointerDown?.({ x: 10, y: 10, raw: {} as PointerEvent });
    draw.onPointerUp?.({ x: 60, y: 50, raw: {} as PointerEvent });
    await flush();
    assert.ok(host.querySelector('.mn-design-overlay-shapes')!.childNodes.length > 0);

    draw.disarm();
    assert.equal(host.querySelector('.mn-design-overlay-shapes')!.childNodes.length, 0);
  });

  test('comment tool: pointer up drops a numbered pin and renders it in the pin layer', async () => {
    const comment = createCommentDesignTool();
    const ctx = makeCtx();
    comment.arm(ctx);
    await flush();

    comment.onPointerUp?.({ x: 40, y: 60, raw: {} as PointerEvent });
    await flush();

    const pins = comment.getPins();
    assert.equal(pins.length, 1);
    assert.equal(pins[0]?.index, 1);
    assert.equal(pins[0]?.x, 40);
    assert.equal(pins[0]?.y, 60);

    const pinCircles = host.querySelectorAll('.mn-design-overlay-pins circle');
    assert.equal(pinCircles.length, 1);

    assert.equal(putBodies.length, 1);
    assert.equal(putBodies[0]?.annotations.pins.length, 1);
    comment.disarm();
  });

  test('addNote threads a plain-text note with a timestamp onto the pin', async () => {
    const comment = createCommentDesignTool();
    const ctx = makeCtx();
    comment.arm(ctx);
    await flush();

    comment.onPointerUp?.({ x: 40, y: 60, raw: {} as PointerEvent });
    await flush();
    const pinId = comment.getPins()[0]?.id;
    assert.ok(pinId);

    await comment.addNote(pinId!, 'looks great, ship it');
    const pin = comment.getPins().find((p) => p.id === pinId);
    assert.equal(pin?.notes.length, 1);
    assert.equal(pin?.notes[0]?.text, 'looks great, ship it');
    assert.ok(typeof pin?.notes[0]?.createdAt === 'number');
    comment.disarm();
  });

  test('erasePin removes the pin and its thread', async () => {
    const comment = createCommentDesignTool();
    const ctx = makeCtx();
    comment.arm(ctx);
    await flush();

    comment.onPointerUp?.({ x: 40, y: 60, raw: {} as PointerEvent });
    await flush();
    const pinId = comment.getPins()[0]?.id;
    await comment.addNote(pinId!, 'note');

    comment.erasePin(pinId!);
    await flush();
    assert.equal(comment.getPins().length, 0);
    comment.disarm();
  });

  test('draw shows a live draft while dragging and clears it on pointer up', async () => {
    const draw = createDrawDesignTool();
    const ctx = makeCtx();
    draw.arm(ctx);
    await flush();

    draw.onPointerDown?.({ x: 10, y: 10, raw: {} as PointerEvent });
    draw.onPointerMove?.({ x: 60, y: 50, raw: {} as PointerEvent });
    const draft = host.querySelector('.mn-design-overlay-draft');
    assert.ok(draft);
    assert.ok(draft!.childNodes.length > 0, 'draft rect should render during the drag');

    draw.onPointerUp?.({ x: 60, y: 50, raw: {} as PointerEvent });
    await flush();
    assert.equal(draft!.childNodes.length, 0, 'draft clears once the shape is committed');
    assert.equal(draw.getShapes().length, 1);
    draw.disarm();
  });

  test('clicking an existing pin reopens its thread instead of stacking a duplicate pin', async () => {
    const comment = createCommentDesignTool();
    const ctx = makeCtx();
    comment.arm(ctx);
    await flush();

    comment.onPointerUp?.({ x: 40, y: 60, raw: {} as PointerEvent });
    await flush();
    assert.equal(comment.getPins().length, 1);
    // Dismiss the popover the new pin opened, then click the pin itself.
    host.querySelector<HTMLButtonElement>('.mn-design-pin-popover__close')?.click();

    comment.onPointerUp?.({ x: 42, y: 58, raw: {} as PointerEvent });
    await flush();
    assert.equal(comment.getPins().length, 1, 'no duplicate pin within the hit radius');
    assert.ok(host.querySelector('.mn-design-pin-popover'), 'thread popover reopened');
    comment.disarm();
  });

  test('clicking elsewhere while a thread is open dismisses it instead of dropping a pin', async () => {
    const comment = createCommentDesignTool();
    const ctx = makeCtx();
    comment.arm(ctx);
    await flush();

    comment.onPointerUp?.({ x: 40, y: 60, raw: {} as PointerEvent });
    await flush();
    assert.ok(host.querySelector('.mn-design-pin-popover'));

    comment.onPointerUp?.({ x: 200, y: 200, raw: {} as PointerEvent });
    await flush();
    assert.equal(comment.getPins().length, 1);
    assert.equal(host.querySelector('.mn-design-pin-popover'), null);
    comment.disarm();
  });

  test('Enter in the popover input adds a note to the thread', async () => {
    const comment = createCommentDesignTool();
    const ctx = makeCtx();
    comment.arm(ctx);
    await flush();

    comment.onPointerUp?.({ x: 40, y: 60, raw: {} as PointerEvent });
    await flush();
    const input = host.querySelector<HTMLInputElement>('.mn-design-pin-popover__input')!;
    input.value = 'tighten this spacing';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    const pin = comment.getPins()[0];
    assert.equal(pin?.notes.length, 1);
    assert.equal(pin?.notes[0]?.text, 'tighten this spacing');
    comment.disarm();
  });

  test('comment pins do not push composer attachments (comments are markup, not chat turns)', async () => {
    const comment = createCommentDesignTool();
    const ctx = makeCtx();
    comment.arm(ctx);
    await flush();

    comment.onPointerUp?.({ x: 40, y: 60, raw: {} as PointerEvent });
    await flush();

    assert.equal(getPendingAttachments().length, 0);
    comment.disarm();
  });

  test('clearAllDesignModeMarks wipes draw shapes, comment pins, and composer design refs for the page', async () => {
    const draw = createDrawDesignTool();
    const comment = createCommentDesignTool();
    registerDesignTool(createSelectDesignTool());
    registerDesignTool(draw);
    registerDesignTool(comment);

    const ctx = makeCtx();
    (draw as DrawDesignTool).arm(ctx);
    await flush();

    draw.onPointerDown?.({ x: 10, y: 10, raw: {} as PointerEvent });
    draw.onPointerMove?.({ x: 50, y: 50, raw: {} as PointerEvent });
    draw.onPointerUp?.({ x: 50, y: 50, raw: {} as PointerEvent });
    await flush();

    (comment as CommentDesignTool).arm(ctx);
    await flush();
    comment.onPointerUp?.({ x: 80, y: 90, raw: {} as PointerEvent });
    await flush();

    assert.equal(draw.getShapes().length, 1);
    assert.equal(comment.getPins().length, 1);
    assert.equal(getPendingAttachments().filter((a) => a.kind === 'designRef').length, 1);

    await clearAllDesignModeMarks(ctx);
    await flush();

    assert.equal(draw.getShapes().length, 0);
    assert.equal(comment.getPins().length, 0);
    assert.equal(getPendingAttachments().filter((a) => a.kind === 'designRef').length, 0);
    assert.equal(host.querySelectorAll('.mn-design-overlay-shapes *').length, 0);
    assert.equal(host.querySelectorAll('.mn-design-overlay-pins *').length, 0);

    draw.disarm();
    comment.disarm();
  });
});
