/**
 * Bidirectional annotation <-> chat linking (MIN-368): link stamping on send
 * (linkAnnotationsToTurn / linkSentAttachmentsToTurn) and the dead-anchor classification
 * (isAnchorDead) the transcript/panel "moved or removed" badge is driven by.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  addShape,
  isAnchorDead,
  linkAnnotationsToTurn,
  linkSentAttachmentsToTurn,
  loadPageAnnotations,
  resetAnnotationStoreForTests,
} from '../../src/design/annotation-store.ts';
import type { AnchorCandidate, DesignShape } from '../../src/design/shape-model.ts';
import type { Attachment } from '../../src/attachments/types.ts';

function rectShape(id: string, anchor: DesignShape['anchor']): DesignShape {
  return {
    id,
    kind: 'rect',
    rect: { x: 1, y: 2, width: 10, height: 10 },
    anchor,
    createdAt: 1,
  };
}

function designRefAttachment(shape: DesignShape, pageUrl: string): Attachment {
  return {
    id: `dref-${shape.id}`,
    name: `rect — ${pageUrl}`,
    kind: 'designRef',
    mimeType: 'text/plain',
    size: 10,
    shape,
    pageUrl,
    intentText: 'rect at 1,2 10×10 = region of interest',
  };
}

describe('linkAnnotationsToTurn', () => {
  let putBodies: Array<{ page: string; annotations: unknown }>;

  beforeEach(() => {
    resetAnnotationStoreForTests();
    putBodies = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        putBodies.push(body);
        return { ok: true, json: async () => ({ ok: true, data: body.annotations }) } as Response;
      }
      return { ok: true, json: async () => ({ shapes: [], pins: [] }) } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    resetAnnotationStoreForTests();
  });

  test('stamps the target shape with a link and persists it', async () => {
    await addShape('pricing.html', rectShape('s1', { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 }));
    const result = await linkAnnotationsToTurn(
      'pricing.html',
      { shapeIds: ['s1'] },
      { chatId: 'chat-a', turnId: '3' },
    );
    assert.equal(result?.shapes[0]?.links?.length, 1);
    assert.equal(result?.shapes[0]?.links?.[0]?.chatId, 'chat-a');
    assert.equal(result?.shapes[0]?.links?.[0]?.turnId, '3');
    assert.equal(typeof result?.shapes[0]?.links?.[0]?.at, 'number');
    // Persisted, not just in-memory.
    const lastPut = putBodies[putBodies.length - 1];
    assert.equal((lastPut?.annotations as { shapes: DesignShape[] }).shapes[0]?.links?.length, 1);
  });

  test('a shape linked from two different sends keeps both links, newest first', async () => {
    await addShape('pricing.html', rectShape('s1', { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 }));
    await linkAnnotationsToTurn('pricing.html', { shapeIds: ['s1'] }, { chatId: 'chat-a', turnId: '1' });
    const result = await linkAnnotationsToTurn(
      'pricing.html',
      { shapeIds: ['s1'] },
      { chatId: 'chat-b', turnId: '5' },
    );
    const links = result?.shapes[0]?.links ?? [];
    assert.equal(links.length, 2);
    assert.equal(links[0]?.chatId, 'chat-b');
    assert.equal(links[1]?.chatId, 'chat-a');
  });

  test('leaves shapes not in the target id list untouched', async () => {
    await addShape('pricing.html', rectShape('s1', { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 }));
    await addShape('pricing.html', rectShape('s2', { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 }));
    const result = await linkAnnotationsToTurn(
      'pricing.html',
      { shapeIds: ['s1'] },
      { chatId: 'chat-a', turnId: '1' },
    );
    assert.equal(result?.shapes.find((s) => s.id === 's1')?.links?.length, 1);
    assert.equal(result?.shapes.find((s) => s.id === 's2')?.links, undefined);
  });

  test('returns null and does not persist when there are no target ids', async () => {
    await addShape('pricing.html', rectShape('s1', { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 }));
    const before = putBodies.length;
    const result = await linkAnnotationsToTurn('pricing.html', {}, { chatId: 'chat-a', turnId: '1' });
    assert.equal(result, null);
    assert.equal(putBodies.length, before);
  });
});

describe('linkSentAttachmentsToTurn', () => {
  let putBodies: Array<{ page: string; annotations: unknown }>;

  beforeEach(() => {
    resetAnnotationStoreForTests();
    putBodies = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        putBodies.push(body);
        return { ok: true, json: async () => ({ ok: true, data: body.annotations }) } as Response;
      }
      return { ok: true, json: async () => ({ shapes: [], pins: [] }) } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    resetAnnotationStoreForTests();
  });

  test('links every designRef attachment shape to the turn, grouped by page', async () => {
    // Load first (marks the in-memory page state "loaded"), same order design-tool.ts's Draw
    // tool arm() always uses — addShape mutates in-memory state directly without flipping
    // `loaded`, so a later loadPageAnnotations() with no prior load would re-fetch (and here,
    // clobber) instead of returning the mutated in-memory state.
    await loadPageAnnotations('pricing.html');
    await loadPageAnnotations('checkout.html');
    const shapeA = rectShape('sA', { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 });
    const shapeB = rectShape('sB', { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 });
    await addShape('pricing.html', shapeA);
    await addShape('checkout.html', shapeB);

    await linkSentAttachmentsToTurn('chat-1', '7', [
      designRefAttachment(shapeA, 'pricing.html'),
      designRefAttachment(shapeB, 'checkout.html'),
    ]);

    const pricing = await loadPageAnnotations('pricing.html');
    const checkout = await loadPageAnnotations('checkout.html');
    assert.equal(pricing.shapes[0]?.links?.[0]?.chatId, 'chat-1');
    assert.equal(pricing.shapes[0]?.links?.[0]?.turnId, '7');
    assert.equal(checkout.shapes[0]?.links?.[0]?.chatId, 'chat-1');
  });

  test('ignores non-designRef attachments (elementRef picks have no annotation-store entry)', async () => {
    const shape = rectShape('sC', { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 });
    await addShape('pricing.html', shape);
    const before = putBodies.length;

    const elementRefAttachment: Attachment = {
      id: 'eref-1',
      name: 'button.cta — pricing.html',
      kind: 'elementRef',
      mimeType: 'text/html',
      size: 1,
      selector: 'button.cta',
      pageUrl: 'pricing.html',
      tagName: 'button',
      classList: [],
      outerHtmlPreview: '<button></button>',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      stylesDigest: '',
    };
    await linkSentAttachmentsToTurn('chat-1', '2', [elementRefAttachment]);
    assert.equal(putBodies.length, before);
  });

  test('two shapes sent in the same turn both link to it (acceptance: "send two annotated regions")', async () => {
    await loadPageAnnotations('pricing.html');
    const shapeA = rectShape('r1', { type: 'element', uid: 7, selector: '[data-mn-uid="7"]' });
    const shapeB = rectShape('r2', { type: 'element', uid: 99, selector: 'button.gone' });
    await addShape('pricing.html', shapeA);
    await addShape('pricing.html', shapeB);

    await linkSentAttachmentsToTurn('chat-1', '4', [
      designRefAttachment(shapeA, 'pricing.html'),
      designRefAttachment(shapeB, 'pricing.html'),
    ]);

    const data = await loadPageAnnotations('pricing.html');
    assert.equal(data.shapes.find((s) => s.id === 'r1')?.links?.[0]?.turnId, '4');
    assert.equal(data.shapes.find((s) => s.id === 'r2')?.links?.[0]?.turnId, '4');
  });
});

describe('isAnchorDead', () => {
  test('resolves by uid match', () => {
    const candidates: AnchorCandidate[] = [
      { uid: 7, selector: 'button.cta', rect: { x: 0, y: 0, width: 1, height: 1 } },
    ];
    assert.equal(
      isAnchorDead({ type: 'element', uid: 7, selector: 'button.old' }, candidates),
      false,
    );
  });

  test('falls back to selector match when uid misses', () => {
    const candidates: AnchorCandidate[] = [
      { uid: 3, selector: 'button.cta', rect: { x: 0, y: 0, width: 1, height: 1 } },
    ];
    assert.equal(
      isAnchorDead({ type: 'element', uid: 999, selector: 'button.cta' }, candidates),
      false,
    );
  });

  test('dead when uid AND selector both fail to resolve', () => {
    const candidates: AnchorCandidate[] = [
      { uid: 3, selector: 'button.other', rect: { x: 0, y: 0, width: 1, height: 1 } },
    ];
    assert.equal(
      isAnchorDead({ type: 'element', uid: 999, selector: 'button.gone' }, candidates),
      true,
    );
  });

  test('dead when there are no candidates at all', () => {
    assert.equal(isAnchorDead({ type: 'element', uid: 1, selector: 'x' }, []), true);
  });

  test('page-anchored items are never dead', () => {
    assert.equal(
      isAnchorDead({ type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 }, []),
      false,
    );
  });
});
