/**
 * Draw & Comment tool shape model (MIN-367): pure data shapes, freehand point-thinning, and
 * anchor resolution (tagged element vs. bare page position). No DOM/overlay coupling —
 * design-tool.ts renders shapes via overlay.ts and persists them via annotation-store.ts.
 */

export type ShapeKind = 'pen' | 'rect' | 'arrow' | 'label';

export interface ShapePoint {
  x: number;
  y: number;
}

export interface ShapeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a shape/pin sits: a tagged `data-mn-uid` element, or a bare page position. */
export type ShapeAnchor =
  | { type: 'element'; uid: number | null; selector: string }
  | { type: 'page'; x: number; y: number; scrollX: number; scrollY: number };

/**
 * One chat turn a shape/pin was sent to (MIN-368) — bidirectional annotation <-> chat linking.
 * `turnId` mirrors the `data-history-index` identity messages.ts/message-actions.ts already
 * stamp on rendered message rows (chat.history has no persisted message ids of its own).
 */
export interface AnnotationLink {
  chatId: string;
  turnId: string;
  at: number;
}

/** One drawn shape (pen stroke, rectangle, arrow, or text label). */
export interface DesignShape {
  id: string;
  kind: ShapeKind;
  /** Freehand path (kind: 'pen', thinned) or arrow endpoints [from, to] (kind: 'arrow'). */
  points?: ShapePoint[];
  /** Bounding geometry for rect/label shapes (host CSS px). */
  rect?: ShapeRect;
  /** Caption/instruction text — required for 'label', optional annotation on other kinds. */
  label?: string;
  anchor: ShapeAnchor;
  createdAt: number;
  /** Chat turns this shape was sent to (MIN-368), newest first. */
  links?: AnnotationLink[];
}

/** One threaded note on a comment pin. */
export interface CommentNote {
  id: string;
  text: string;
  createdAt: number;
}

/** A numbered comment pin with a thread of plain-text notes. */
export interface CommentPin {
  id: string;
  index: number;
  x: number;
  y: number;
  anchor: ShapeAnchor;
  notes: CommentNote[];
  /** Chat turns this pin was sent to (MIN-368), newest first. */
  links?: AnnotationLink[];
}

let counter = 0;

function nextSuffix(): string {
  counter += 1;
  return `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newShapeId(): string {
  return `dshape-${nextSuffix()}`;
}

export function newPinId(): string {
  return `dpin-${nextSuffix()}`;
}

export function newNoteId(): string {
  return `dnote-${nextSuffix()}`;
}

/** Reset the id counter between tests for deterministic assertions. */
export function resetShapeIdCounterForTests(): void {
  counter = 0;
}

function distance(a: ShapePoint, b: ShapePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Simple point-thinning smoothing for freehand pen strokes: keep a point only when it is at
 * least `minDistance` from the last kept point. Always keeps the first and last point so the
 * stroke's start/end don't drift.
 */
export function thinPoints(points: ShapePoint[], minDistance = 3): ShapePoint[] {
  if (points.length <= 2) return [...points];
  const kept: ShapePoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i]!;
    if (distance(kept[kept.length - 1]!, point) >= minDistance) {
      kept.push(point);
    }
  }
  const last = points[points.length - 1]!;
  if (distance(kept[kept.length - 1]!, last) > 0) kept.push(last);
  return kept;
}

/** Axis-aligned bounding rect of a set of points. */
export function boundingRectOfPoints(points: ShapePoint[]): ShapeRect {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = points[0]!.x;
  let maxY = points[0]!.y;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

/** Bounding rect covering a shape's geometry, regardless of kind. */
export function boundingRectOfShape(shape: DesignShape): ShapeRect {
  if (shape.rect) return { ...shape.rect };
  if (shape.points?.length) return boundingRectOfPoints(shape.points);
  return { x: 0, y: 0, width: 0, height: 0 };
}

function overlapArea(a: ShapeRect, b: ShapeRect): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

/** A tagged `data-mn-uid` element candidate for anchor hit-testing. */
export interface AnchorCandidate {
  uid: number;
  selector: string;
  rect: ShapeRect;
}

export interface PagePosition {
  x: number;
  y: number;
  scrollX: number;
  scrollY: number;
}

const DEFAULT_MIN_OVERLAP_RATIO = 0.15;

/**
 * Hit-test a shape's region against already-tagged `data-mn-uid` elements. The candidate whose
 * rect overlaps the largest fraction of the region wins (min overlap ratio required); otherwise
 * the shape anchors to a bare page position (scroll-relative, so it still makes sense after
 * scroll/reload).
 */
export function resolveShapeAnchor(
  regionRect: ShapeRect,
  candidates: AnchorCandidate[],
  page: PagePosition,
  options?: { minOverlapRatio?: number },
): ShapeAnchor {
  const minOverlapRatio = options?.minOverlapRatio ?? DEFAULT_MIN_OVERLAP_RATIO;
  const regionArea = Math.max(1, regionRect.width * regionRect.height);
  let best: AnchorCandidate | null = null;
  let bestRatio = 0;
  for (const candidate of candidates) {
    const overlap = overlapArea(regionRect, candidate.rect);
    if (overlap <= 0) continue;
    const ratio = overlap / regionArea;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  if (best && bestRatio >= minOverlapRatio) {
    return { type: 'element', uid: best.uid, selector: best.selector };
  }
  return { type: 'page', x: regionRect.x, y: regionRect.y, scrollX: page.scrollX, scrollY: page.scrollY };
}

function round(n: number): number {
  return Math.round(n);
}

/**
 * Structured intent line for chat send — one line per shape describing move/region/instruction
 * semantics, so the agent can act on the drawing without re-deriving intent from pixels alone.
 */
export function structuredIntentForShape(shape: DesignShape): string {
  switch (shape.kind) {
    case 'arrow': {
      const from = shape.points?.[0];
      const to = shape.points?.[1];
      const base =
        from && to
          ? `arrow from ${round(from.x)},${round(from.y)} to ${round(to.x)},${round(to.y)} = move/motion intent`
          : 'arrow = move/motion intent';
      return shape.label ? `${base}: ${shape.label}` : base;
    }
    case 'rect': {
      const r = shape.rect;
      const base = r
        ? `rect at ${round(r.x)},${round(r.y)} ${round(r.width)}×${round(r.height)} = region of interest`
        : 'rect = region of interest';
      return shape.label ? `${base}: ${shape.label}` : base;
    }
    case 'label':
      return `label "${shape.label ?? ''}" = instruction text`;
    case 'pen':
    default: {
      const n = shape.points?.length ?? 0;
      return `freehand mark (${n} points) = freehand annotation`;
    }
  }
}
