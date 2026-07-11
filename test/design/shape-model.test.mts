/**
 * Draw & Comment tool shape model (MIN-367): point-thinning, bounding rects, anchor
 * resolution, and structured intent text. Pure functions — no DOM needed.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  boundingRectOfPoints,
  boundingRectOfShape,
  resolveShapeAnchor,
  structuredIntentForShape,
  thinPoints,
  type AnchorCandidate,
  type DesignShape,
} from '../../src/design/shape-model.ts';

describe('thinPoints', () => {
  test('keeps points at least minDistance apart, always keeping first and last', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 10, y: 0 },
      { x: 10.5, y: 0 },
    ];
    const thinned = thinPoints(points, 3);
    assert.deepEqual(thinned[0], { x: 0, y: 0 });
    assert.deepEqual(thinned[thinned.length - 1], { x: 10.5, y: 0 });
    assert.ok(thinned.length < points.length);
  });

  test('passes through arrays of length <= 2 unchanged', () => {
    assert.deepEqual(thinPoints([]), []);
    assert.deepEqual(thinPoints([{ x: 1, y: 1 }]), [{ x: 1, y: 1 }]);
    const two = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    assert.deepEqual(thinPoints(two), two);
  });
});

describe('boundingRectOfPoints / boundingRectOfShape', () => {
  test('computes the axis-aligned bounding box of a point set', () => {
    const rect = boundingRectOfPoints([
      { x: 5, y: 20 },
      { x: 30, y: 5 },
      { x: 10, y: 15 },
    ]);
    assert.deepEqual(rect, { x: 5, y: 5, width: 25, height: 15 });
  });

  test('empty points collapses to a zero rect', () => {
    assert.deepEqual(boundingRectOfPoints([]), { x: 0, y: 0, width: 0, height: 0 });
  });

  test('shape.rect wins over points when both are present', () => {
    const shape: DesignShape = {
      id: 's1',
      kind: 'rect',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      points: [{ x: 100, y: 100 }],
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      createdAt: 0,
    };
    assert.deepEqual(boundingRectOfShape(shape), { x: 1, y: 2, width: 3, height: 4 });
  });

  test('arrow/pen shapes derive bounding rect from points', () => {
    const shape: DesignShape = {
      id: 's2',
      kind: 'arrow',
      points: [
        { x: 10, y: 10 },
        { x: 50, y: 40 },
      ],
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      createdAt: 0,
    };
    assert.deepEqual(boundingRectOfShape(shape), { x: 10, y: 10, width: 40, height: 30 });
  });
});

describe('resolveShapeAnchor', () => {
  const page = { x: 0, y: 0, scrollX: 12, scrollY: 34 };

  test('anchors to the tagged element with the largest overlap ratio', () => {
    const candidates: AnchorCandidate[] = [
      { uid: 1, selector: '[data-mn-uid="1"]', rect: { x: 0, y: 0, width: 10, height: 10 } },
      { uid: 2, selector: '[data-mn-uid="2"]', rect: { x: 100, y: 100, width: 200, height: 100 } },
    ];
    const region = { x: 90, y: 90, width: 220, height: 120 };
    const anchor = resolveShapeAnchor(region, candidates, page);
    assert.deepEqual(anchor, { type: 'element', uid: 2, selector: '[data-mn-uid="2"]' });
  });

  test('falls back to a page anchor when no candidate clears the overlap threshold', () => {
    const candidates: AnchorCandidate[] = [
      { uid: 1, selector: '[data-mn-uid="1"]', rect: { x: 500, y: 500, width: 10, height: 10 } },
    ];
    const region = { x: 0, y: 0, width: 50, height: 50 };
    const anchor = resolveShapeAnchor(region, candidates, page);
    assert.deepEqual(anchor, { type: 'page', x: 0, y: 0, scrollX: 12, scrollY: 34 });
  });

  test('falls back to a page anchor when there are no candidates at all', () => {
    const region = { x: 5, y: 6, width: 20, height: 20 };
    const anchor = resolveShapeAnchor(region, [], page);
    assert.deepEqual(anchor, { type: 'page', x: 5, y: 6, scrollX: 12, scrollY: 34 });
  });

  test('a barely-overlapping candidate below minOverlapRatio does not win', () => {
    const candidates: AnchorCandidate[] = [
      { uid: 9, selector: '[data-mn-uid="9"]', rect: { x: 99, y: 0, width: 1, height: 100 } },
    ];
    const region = { x: 0, y: 0, width: 100, height: 100 };
    const anchor = resolveShapeAnchor(region, candidates, page, { minOverlapRatio: 0.5 });
    assert.equal(anchor.type, 'page');
  });
});

describe('structuredIntentForShape', () => {
  test('arrow: move/motion intent with rounded endpoints', () => {
    const shape: DesignShape = {
      id: 'a1',
      kind: 'arrow',
      points: [
        { x: 10.4, y: 20.6 },
        { x: 100.2, y: 5.9 },
      ],
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      createdAt: 0,
    };
    assert.equal(
      structuredIntentForShape(shape),
      'arrow from 10,21 to 100,6 = move/motion intent',
    );
  });

  test('arrow with a label appends the caption', () => {
    const shape: DesignShape = {
      id: 'a2',
      kind: 'arrow',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      label: 'move here',
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      createdAt: 0,
    };
    assert.equal(
      structuredIntentForShape(shape),
      'arrow from 0,0 to 10,0 = move/motion intent: move here',
    );
  });

  test('rect: region of interest', () => {
    const shape: DesignShape = {
      id: 'r1',
      kind: 'rect',
      rect: { x: 10, y: 20, width: 100, height: 50 },
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      createdAt: 0,
    };
    assert.equal(
      structuredIntentForShape(shape),
      'rect at 10,20 100×50 = region of interest',
    );
  });

  test('label: instruction text', () => {
    const shape: DesignShape = {
      id: 'l1',
      kind: 'label',
      label: 'Make this bigger',
      rect: { x: 0, y: 0, width: 80, height: 20 },
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      createdAt: 0,
    };
    assert.equal(structuredIntentForShape(shape), 'label "Make this bigger" = instruction text');
  });

  test('pen: freehand annotation with a point count', () => {
    const shape: DesignShape = {
      id: 'p1',
      kind: 'pen',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 0 },
      ],
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      createdAt: 0,
    };
    assert.equal(structuredIntentForShape(shape), 'freehand mark (3 points) = freehand annotation');
  });
});
