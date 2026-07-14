/**
 * Anchor healing + re-pick (MIN-370): the healed/dead/unchanged classification produced by
 * re-running reanchorShape/reanchorPin over a reload, the persisting wrapper, and repickAnnotation's
 * link-preserving anchor transfer.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  healAnnotations,
  healPageAnnotations,
  repickAnnotation,
  resetAnnotationStoreForTests,
} from '../../src/design/annotation-store.ts';
import type { PageAnnotations } from '../../src/design/annotation-store.ts';
import type { AnchorCandidate, CommentPin, DesignShape } from '../../src/design/shape-model.ts';

function elementRectShape(id: string, uid: number, selector: string, rect: DesignShape['rect']): DesignShape {
  return {
    id,
    kind: 'rect',
    rect,
    anchor: { type: 'element', uid, selector },
    createdAt: 1,
  };
}

function elementPin(id: string, uid: number, selector: string, x: number, y: number): CommentPin {
  return {
    id,
    index: 1,
    x,
    y,
    anchor: { type: 'element', uid, selector },
    notes: [],
  };
}

describe('healAnnotations (pure classification)', () => {
  test('element anchor whose element moved is healed and rect updates', () => {
    const shape = elementRectShape('dshape-1', 5, '[data-mn-uid="5"]', { x: 1, y: 2, width: 10, height: 10 });
    const candidates: AnchorCandidate[] = [
      { uid: 5, selector: '[data-mn-uid="5"]', rect: { x: 40, y: 60, width: 10, height: 10 } },
    ];
    const result = healAnnotations({ shapes: [shape], pins: [] }, candidates);
    assert.deepEqual(result.entries, [{ id: 'dshape-1', kind: 'shape', status: 'healed' }]);
    assert.deepEqual(result.data.shapes[0]!.rect, { x: 40, y: 60, width: 10, height: 10 });
  });

  test('element anchor whose element is gone (uid AND selector fail) is classified dead and left as-is', () => {
    const shape = elementRectShape('dshape-2', 9, '[data-mn-uid="9"]', { x: 1, y: 2, width: 10, height: 10 });
    const result = healAnnotations({ shapes: [shape], pins: [] }, []);
    assert.deepEqual(result.entries, [{ id: 'dshape-2', kind: 'shape', status: 'dead' }]);
    assert.deepEqual(result.data.shapes[0], shape);
  });

  test('element anchor resolving to the same rect is unchanged (no badge, no quiet update noise)', () => {
    const shape = elementRectShape('dshape-3', 3, '[data-mn-uid="3"]', { x: 5, y: 5, width: 20, height: 20 });
    const candidates: AnchorCandidate[] = [
      { uid: 3, selector: '[data-mn-uid="3"]', rect: { x: 5, y: 5, width: 20, height: 20 } },
    ];
    const result = healAnnotations({ shapes: [shape], pins: [] }, candidates);
    assert.deepEqual(result.entries, [{ id: 'dshape-3', kind: 'shape', status: 'unchanged' }]);
  });

  test('page anchors are never dead and never healed', () => {
    const shape: DesignShape = {
      id: 'dshape-4',
      kind: 'pen',
      points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      anchor: { type: 'page', x: 1, y: 1, scrollX: 0, scrollY: 0 },
      createdAt: 1,
    };
    const result = healAnnotations({ shapes: [shape], pins: [] }, []);
    assert.deepEqual(result.entries, [{ id: 'dshape-4', kind: 'shape', status: 'unchanged' }]);
  });

  test('pins heal/die the same way as shapes, tracked separately from shapes', () => {
    const pin = elementPin('dpin-1', 7, '[data-mn-uid="7"]', 10, 10);
    const candidates: AnchorCandidate[] = [
      { uid: 7, selector: '[data-mn-uid="7"]', rect: { x: 99, y: 88, width: 1, height: 1 } },
    ];
    const result = healAnnotations({ shapes: [], pins: [pin] }, candidates);
    assert.deepEqual(result.entries, [{ id: 'dpin-1', kind: 'pin', status: 'healed' }]);
    assert.equal(result.data.pins[0]!.x, 99);
    assert.equal(result.data.pins[0]!.y, 88);
  });

  test('uid match wins over a dead selector fallback (mirrors reanchorElementAnchor)', () => {
    const shape = elementRectShape('dshape-5', 1, '[data-mn-uid="stale-selector"]', {
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    const candidates: AnchorCandidate[] = [
      { uid: 1, selector: '[data-mn-uid="1"]', rect: { x: 12, y: 12, width: 5, height: 5 } },
    ];
    const result = healAnnotations({ shapes: [shape], pins: [] }, candidates);
    assert.deepEqual(result.entries, [{ id: 'dshape-5', kind: 'shape', status: 'healed' }]);
    assert.deepEqual(result.data.shapes[0]!.rect, { x: 12, y: 12, width: 5, height: 5 });
  });

  test('links survive healing untouched', () => {
    const shape: DesignShape = {
      ...elementRectShape('dshape-6', 2, '[data-mn-uid="2"]', { x: 0, y: 0, width: 5, height: 5 }),
      links: [{ chatId: 'chat-1', turnId: '3', at: 100 }],
    };
    const candidates: AnchorCandidate[] = [
      { uid: 2, selector: '[data-mn-uid="2"]', rect: { x: 30, y: 30, width: 5, height: 5 } },
    ];
    const result = healAnnotations({ shapes: [shape], pins: [] }, candidates);
    assert.deepEqual(result.data.shapes[0]!.links, [{ chatId: 'chat-1', turnId: '3', at: 100 }]);
  });
});

describe('healPageAnnotations (persisting wrapper)', () => {
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
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
  });

  test('heals, persists the healed rects, and returns the classification', async () => {
    const shape = elementRectShape('dshape-1', 5, '[data-mn-uid="5"]', { x: 1, y: 2, width: 10, height: 10 });
    getResponses.set('pricing.html', { shapes: [shape], pins: [] } satisfies PageAnnotations);

    const candidates: AnchorCandidate[] = [
      { uid: 5, selector: '[data-mn-uid="5"]', rect: { x: 70, y: 80, width: 10, height: 10 } },
    ];
    const result = await healPageAnnotations('pricing.html', candidates);
    assert.deepEqual(result.entries, [{ id: 'dshape-1', kind: 'shape', status: 'healed' }]);
    assert.equal(putBodies.length, 1);
    const persisted = putBodies[0]!.body as { annotations: PageAnnotations };
    assert.deepEqual(persisted.annotations.shapes[0]!.rect, { x: 70, y: 80, width: 10, height: 10 });
  });

  test('empty pageKey is a no-op (no fetches)', async () => {
    const result = await healPageAnnotations('', []);
    assert.deepEqual(result, { data: { shapes: [], pins: [] }, entries: [] });
    assert.equal(putBodies.length, 0);
  });
});

describe('repickAnnotation', () => {
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
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
  });

  test('moves a dead rect shape onto the newly picked element and keeps its links', async () => {
    const shape: DesignShape = {
      ...elementRectShape('dshape-1', 9, '[data-mn-uid="9"]', { x: 1, y: 2, width: 10, height: 10 }),
      links: [{ chatId: 'chat-1', turnId: '2', at: 50 }],
    };
    getResponses.set('pricing.html', { shapes: [shape], pins: [] } satisfies PageAnnotations);

    const updated = await repickAnnotation('pricing.html', 'dshape-1', {
      uid: 42,
      selector: 'button.cta',
      rect: { x: 100, y: 200, width: 30, height: 15 },
    });

    assert.ok(updated);
    const healed = updated!.shapes[0]!;
    assert.deepEqual(healed.anchor, { type: 'element', uid: 42, selector: 'button.cta' });
    assert.deepEqual(healed.rect, { x: 100, y: 200, width: 30, height: 15 });
    assert.deepEqual(healed.links, [{ chatId: 'chat-1', turnId: '2', at: 50 }]);
    assert.equal(putBodies.length, 1);
  });

  test('pen/arrow shapes move anchor but keep their original points untouched', async () => {
    const shape: DesignShape = {
      id: 'dshape-2',
      kind: 'pen',
      points: [{ x: 1, y: 1 }, { x: 9, y: 9 }],
      anchor: { type: 'element', uid: 1, selector: '[data-mn-uid="1"]' },
      createdAt: 1,
    };
    getResponses.set('pricing.html', { shapes: [shape], pins: [] } satisfies PageAnnotations);

    const updated = await repickAnnotation('pricing.html', 'dshape-2', {
      uid: 2,
      selector: '.new-target',
      rect: { x: 500, y: 500, width: 1, height: 1 },
    });

    assert.ok(updated);
    assert.deepEqual(updated!.shapes[0]!.points, [{ x: 1, y: 1 }, { x: 9, y: 9 }]);
    assert.deepEqual(updated!.shapes[0]!.anchor, { type: 'element', uid: 2, selector: '.new-target' });
  });

  test('moves a pin to the new anchor position', async () => {
    const pin = elementPin('dpin-1', 3, '[data-mn-uid="3"]', 5, 5);
    getResponses.set('pricing.html', { shapes: [], pins: [pin] } satisfies PageAnnotations);

    const updated = await repickAnnotation('pricing.html', 'dpin-1', {
      uid: 8,
      selector: '.moved',
      rect: { x: 60, y: 70, width: 1, height: 1 },
    });

    assert.ok(updated);
    assert.equal(updated!.pins[0]!.x, 60);
    assert.equal(updated!.pins[0]!.y, 70);
    assert.deepEqual(updated!.pins[0]!.anchor, { type: 'element', uid: 8, selector: '.moved' });
  });

  test('returns null and does not persist when the annotation id does not exist', async () => {
    getResponses.set('pricing.html', { shapes: [], pins: [] } satisfies PageAnnotations);
    const updated = await repickAnnotation('pricing.html', 'dshape-missing', {
      uid: 1,
      selector: '.x',
      rect: { x: 0, y: 0, width: 1, height: 1 },
    });
    assert.equal(updated, null);
    assert.equal(putBodies.length, 0);
  });
});
