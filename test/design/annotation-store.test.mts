/**
 * Draw & Comment annotation persistence (MIN-367): load/save round trip against a mocked
 * fetch (the real GET/PUT /api/design/annotations route is exercised server-side in
 * test/server/design-annotations-middleware.test.mjs), eraser + undo, and re-anchor logic.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  addNoteToPin,
  addPin,
  addShape,
  clearPageAnnotations,
  eraseShape,
  erasePin,
  loadPageAnnotations,
  reanchorPin,
  reanchorShape,
  resetAnnotationStoreForTests,
  undoPage,
} from '../../src/design/annotation-store.ts';
import type { AnchorCandidate, CommentPin, DesignShape } from '../../src/design/shape-model.ts';

function rectShape(id: string): DesignShape {
  return {
    id,
    kind: 'rect',
    rect: { x: 1, y: 2, width: 10, height: 10 },
    anchor: { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 },
    createdAt: 1,
  };
}

describe('annotation-store persistence', () => {
  let putBodies: Array<{ url: string; body: unknown }>;
  let getResponses: Map<string, unknown>;

  beforeEach(() => {
    resetAnnotationStoreForTests();
    putBodies = [];
    getResponses = new Map();
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        putBodies.push({ url, body });
        return { ok: true, json: async () => ({ ok: true, data: body.annotations }) } as Response;
      }
      const page = new URL(url, 'http://localhost').searchParams.get('page') ?? '';
      const data = getResponses.get(page);
      if (!data) return { ok: true, json: async () => ({ shapes: [], pins: [] }) } as Response;
      return { ok: true, json: async () => data } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    resetAnnotationStoreForTests();
  });

  test('loadPageAnnotations returns empty state for an unknown page without an empty pageKey call', async () => {
    const data = await loadPageAnnotations('pricing.html');
    assert.deepEqual(data, { shapes: [], pins: [] });
  });

  test('loadPageAnnotations short-circuits (no fetch) for an empty page key', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
    const data = await loadPageAnnotations('');
    assert.deepEqual(data, { shapes: [], pins: [] });
    assert.equal(fetchCalled, false);
  });

  test('addShape persists via PUT and round-trips through GET on a fresh load', async () => {
    const shape = rectShape('s1');
    const result = await addShape('pricing.html', shape);
    assert.equal(result.shapes.length, 1);
    assert.equal(putBodies.length, 1);
    assert.equal(putBodies[0]?.body.page, 'pricing.html');
    assert.deepEqual(putBodies[0]?.body.annotations.shapes, [shape]);

    // Simulate reload: fresh store, GET now returns what PUT persisted.
    resetAnnotationStoreForTests();
    getResponses.set('pricing.html', putBodies[0]?.body.annotations);
    const reloaded = await loadPageAnnotations('pricing.html');
    assert.deepEqual(reloaded.shapes, [shape]);
  });

  test('addPin + addNoteToPin thread notes with timestamps and persist', async () => {
    const pin: CommentPin = {
      id: 'p1',
      index: 1,
      x: 10,
      y: 20,
      anchor: { type: 'page', x: 10, y: 20, scrollX: 0, scrollY: 0 },
      notes: [],
    };
    await addPin('pricing.html', pin);
    const updated = await addNoteToPin('pricing.html', 'p1', 'looks good');
    assert.ok(updated);
    assert.equal(updated?.pins[0]?.notes.length, 1);
    assert.equal(updated?.pins[0]?.notes[0]?.text, 'looks good');
    assert.ok(typeof updated?.pins[0]?.notes[0]?.createdAt === 'number');
  });

  test('addNoteToPin is a no-op for an unknown pin id or blank text', async () => {
    const pin: CommentPin = {
      id: 'p1',
      index: 1,
      x: 0,
      y: 0,
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      notes: [],
    };
    await addPin('pricing.html', pin);
    assert.equal(await addNoteToPin('pricing.html', 'missing', 'hi'), null);
    assert.equal(await addNoteToPin('pricing.html', 'p1', '   '), null);
  });

  test('eraseShape removes the shape and persists; erasePin removes the pin and its thread', async () => {
    await addShape('pricing.html', rectShape('s1'));
    await addShape('pricing.html', rectShape('s2'));
    const afterErase = await eraseShape('pricing.html', 's1');
    assert.deepEqual(
      afterErase.shapes.map((s) => s.id),
      ['s2'],
    );

    const pin: CommentPin = {
      id: 'p1',
      index: 1,
      x: 0,
      y: 0,
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      notes: [],
    };
    await addPin('pricing.html', pin);
    const afterPinErase = await erasePin('pricing.html', 'p1');
    assert.equal(afterPinErase.pins.length, 0);
  });

  test('undoPage restores the prior snapshot (per-page stack) and persists it', async () => {
    await addShape('pricing.html', rectShape('s1'));
    await addShape('pricing.html', rectShape('s2'));
    const undone = await undoPage('pricing.html');
    assert.ok(undone);
    assert.deepEqual(
      undone?.shapes.map((s) => s.id),
      ['s1'],
    );
    // Undo persisted the restored state too.
    assert.deepEqual(
      putBodies[putBodies.length - 1]?.body.annotations.shapes.map((s: DesignShape) => s.id),
      ['s1'],
    );
  });

  test('undoPage returns null once the per-page stack is exhausted', async () => {
    await addShape('pricing.html', rectShape('s1'));
    await undoPage('pricing.html');
    assert.equal(await undoPage('pricing.html'), null);
  });

  test('undo stacks are independent per page', async () => {
    await addShape('pricing.html', rectShape('s1'));
    await addShape('checkout.html', rectShape('s2'));
    const undonePricing = await undoPage('pricing.html');
    assert.equal(undonePricing?.shapes.length, 0);
    // checkout.html's shape must be untouched by pricing.html's undo — undoPage('checkout.html')
    // still has its one add-shape snapshot to pop back to (an empty list), proving the two
    // pages' stacks never merged.
    const undoneCheckout = await undoPage('checkout.html');
    assert.equal(undoneCheckout?.shapes.length, 0);
    assert.equal(await undoPage('checkout.html'), null);
  });

  test('clearPageAnnotations wipes shapes and pins and persists an empty page', async () => {
    await addShape('pricing.html', rectShape('s1'));
    await addPin('pricing.html', {
      id: 'p1',
      index: 1,
      x: 5,
      y: 6,
      anchor: { type: 'page', x: 5, y: 6, scrollX: 0, scrollY: 0 },
      notes: [],
    });

    const cleared = await clearPageAnnotations('pricing.html');
    assert.deepEqual(cleared, { shapes: [], pins: [] });

    const reloaded = await loadPageAnnotations('pricing.html');
    assert.deepEqual(reloaded, { shapes: [], pins: [] });

    const lastPut = putBodies.at(-1);
    assert.equal(lastPut?.body.page, 'pricing.html');
    assert.deepEqual(lastPut?.body.annotations, { shapes: [], pins: [] });
  });
});

describe('re-anchoring on load', () => {
  test('reanchorShape re-fits a rect/label shape to the matched element by uid', () => {
    const shape: DesignShape = {
      id: 's1',
      kind: 'rect',
      rect: { x: 1, y: 1, width: 10, height: 10 },
      anchor: { type: 'element', uid: 7, selector: '[data-mn-uid="7"]' },
      createdAt: 1,
    };
    const candidates: AnchorCandidate[] = [
      { uid: 7, selector: '[data-mn-uid="7"]', rect: { x: 50, y: 60, width: 20, height: 20 } },
    ];
    const reanchored = reanchorShape(shape, candidates);
    assert.deepEqual(reanchored.rect, { x: 50, y: 60, width: 20, height: 20 });
  });

  test('reanchorShape falls back from uid to selector match', () => {
    const shape: DesignShape = {
      id: 's1',
      kind: 'rect',
      rect: { x: 1, y: 1, width: 10, height: 10 },
      anchor: { type: 'element', uid: 999, selector: 'button.cta' },
      createdAt: 1,
    };
    const candidates: AnchorCandidate[] = [
      { uid: 3, selector: 'button.cta', rect: { x: 8, y: 9, width: 5, height: 5 } },
    ];
    const reanchored = reanchorShape(shape, candidates);
    assert.deepEqual(reanchored.rect, { x: 8, y: 9, width: 5, height: 5 });
  });

  test('reanchorShape keeps the last-known rect when no candidate matches (rect fallback)', () => {
    const shape: DesignShape = {
      id: 's1',
      kind: 'rect',
      rect: { x: 1, y: 1, width: 10, height: 10 },
      anchor: { type: 'element', uid: 7, selector: '[data-mn-uid="7"]' },
      createdAt: 1,
    };
    const reanchored = reanchorShape(shape, []);
    assert.deepEqual(reanchored.rect, shape.rect);
  });

  test('page-anchored shapes are untouched by re-anchoring', () => {
    const shape: DesignShape = {
      id: 's1',
      kind: 'rect',
      rect: { x: 1, y: 1, width: 10, height: 10 },
      anchor: { type: 'page', x: 1, y: 1, scrollX: 0, scrollY: 0 },
      createdAt: 1,
    };
    const candidates: AnchorCandidate[] = [
      { uid: 7, selector: '[data-mn-uid="7"]', rect: { x: 999, y: 999, width: 1, height: 1 } },
    ];
    assert.deepEqual(reanchorShape(shape, candidates), shape);
  });

  test('reanchorPin moves the pin to the matched element position', () => {
    const pin: CommentPin = {
      id: 'p1',
      index: 1,
      x: 1,
      y: 1,
      anchor: { type: 'element', uid: 5, selector: '[data-mn-uid="5"]' },
      notes: [],
    };
    const candidates: AnchorCandidate[] = [
      { uid: 5, selector: '[data-mn-uid="5"]', rect: { x: 30, y: 40, width: 8, height: 8 } },
    ];
    const reanchored = reanchorPin(pin, candidates);
    assert.equal(reanchored.x, 30);
    assert.equal(reanchored.y, 40);
  });
});
