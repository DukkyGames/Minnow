/**
 * Draw & Comment annotation persistence (MIN-367): loads/saves shapes + comment pins for the
 * current page via GET/PUT /api/design/annotations (server/design/annotations-routes.js),
 * keyed by page identity (workspace-relative path or normalized preview URL — same key
 * design-tool.ts's `currentPreviewPageRef()` already uses for elementRef/designRef `pageUrl`).
 * Keeps a per-page undo stack in memory (snapshot-before-mutation) so eraser/undo work without
 * a round trip, then persists the result.
 */

import { isDesignRefAttachment } from '../attachments/design-ref';
import type { Attachment } from '../attachments/types';
import { boundingRectOfShape } from './shape-model';
import type {
  AnchorCandidate,
  AnnotationLink,
  CommentPin,
  DesignShape,
  ShapeAnchor,
  ShapeRect,
} from './shape-model';

export interface PageAnnotations {
  shapes: DesignShape[];
  pins: CommentPin[];
}

function emptyAnnotations(): PageAnnotations {
  return { shapes: [], pins: [] };
}

function cloneLinks(links: AnnotationLink[] | undefined): AnnotationLink[] | undefined {
  return links ? links.map((link) => ({ ...link })) : undefined;
}

function cloneAnnotations(data: PageAnnotations): PageAnnotations {
  return {
    shapes: data.shapes.map((shape) => ({
      ...shape,
      ...(shape.points ? { points: shape.points.map((p) => ({ ...p })) } : {}),
      ...(shape.rect ? { rect: { ...shape.rect } } : {}),
      anchor: { ...shape.anchor },
      ...(shape.links ? { links: cloneLinks(shape.links) } : {}),
    })),
    pins: data.pins.map((pin) => ({
      ...pin,
      anchor: { ...pin.anchor },
      notes: pin.notes.map((note) => ({ ...note })),
      ...(pin.links ? { links: cloneLinks(pin.links) } : {}),
    })),
  };
}

interface PageState {
  data: PageAnnotations;
  undoStack: PageAnnotations[];
  loaded: boolean;
  loadPromise: Promise<PageAnnotations> | null;
}

const pages = new Map<string, PageState>();

function getState(pageKey: string): PageState {
  let state = pages.get(pageKey);
  if (!state) {
    state = { data: emptyAnnotations(), undoStack: [], loaded: false, loadPromise: null };
    pages.set(pageKey, state);
  }
  return state;
}

function normalizeAnnotations(raw: unknown): PageAnnotations {
  if (!raw || typeof raw !== 'object') return emptyAnnotations();
  const row = raw as Record<string, unknown>;
  const shapes = Array.isArray(row.shapes) ? (row.shapes as DesignShape[]) : [];
  const pins = Array.isArray(row.pins) ? (row.pins as CommentPin[]) : [];
  return { shapes, pins };
}

/** Load a page's annotations (cached after first call per page key). */
export async function loadPageAnnotations(pageKey: string): Promise<PageAnnotations> {
  if (!pageKey) return emptyAnnotations();
  const state = getState(pageKey);
  if (state.loaded) return cloneAnnotations(state.data);
  if (state.loadPromise) return state.loadPromise;

  state.loadPromise = (async (): Promise<PageAnnotations> => {
    try {
      const res = await fetch(`/api/design/annotations?page=${encodeURIComponent(pageKey)}`, {
        cache: 'no-store',
      });
      state.data = res.ok ? normalizeAnnotations(await res.json()) : emptyAnnotations();
    } catch {
      state.data = emptyAnnotations();
    } finally {
      state.loaded = true;
      state.loadPromise = null;
    }
    return cloneAnnotations(state.data);
  })();

  return state.loadPromise;
}

async function persist(pageKey: string): Promise<void> {
  const state = getState(pageKey);
  try {
    await fetch('/api/design/annotations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: pageKey, annotations: state.data }),
    });
  } catch {
    /* best-effort — annotations stay in memory even if the write fails */
  }
}

function pushUndoSnapshot(pageKey: string): void {
  const state = getState(pageKey);
  state.undoStack.push(cloneAnnotations(state.data));
}

/** Append a drawn shape to the page's annotations and persist. */
export async function addShape(pageKey: string, shape: DesignShape): Promise<PageAnnotations> {
  const state = getState(pageKey);
  pushUndoSnapshot(pageKey);
  state.data = { ...state.data, shapes: [...state.data.shapes, shape] };
  await persist(pageKey);
  return cloneAnnotations(state.data);
}

/** Append a comment pin to the page's annotations and persist. */
export async function addPin(pageKey: string, pin: CommentPin): Promise<PageAnnotations> {
  const state = getState(pageKey);
  pushUndoSnapshot(pageKey);
  state.data = { ...state.data, pins: [...state.data.pins, pin] };
  await persist(pageKey);
  return cloneAnnotations(state.data);
}

/** Append a plain-text note (with timestamp) to an existing pin's thread and persist. */
export async function addNoteToPin(
  pageKey: string,
  pinId: string,
  text: string,
): Promise<PageAnnotations | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const state = getState(pageKey);
  const pin = state.data.pins.find((p) => p.id === pinId);
  if (!pin) return null;
  pushUndoSnapshot(pageKey);
  const note = { id: `dnote-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: trimmed, createdAt: Date.now() };
  state.data = {
    ...state.data,
    pins: state.data.pins.map((p) => (p.id === pinId ? { ...p, notes: [...p.notes, note] } : p)),
  };
  await persist(pageKey);
  return cloneAnnotations(state.data);
}

/** Remove one shape (eraser) and persist. */
export async function eraseShape(pageKey: string, shapeId: string): Promise<PageAnnotations> {
  const state = getState(pageKey);
  pushUndoSnapshot(pageKey);
  state.data = { ...state.data, shapes: state.data.shapes.filter((s) => s.id !== shapeId) };
  await persist(pageKey);
  return cloneAnnotations(state.data);
}

/** Remove one comment pin (and its thread) and persist. */
export async function erasePin(pageKey: string, pinId: string): Promise<PageAnnotations> {
  const state = getState(pageKey);
  pushUndoSnapshot(pageKey);
  state.data = { ...state.data, pins: state.data.pins.filter((p) => p.id !== pinId) };
  await persist(pageKey);
  return cloneAnnotations(state.data);
}

/** Pop the page's undo stack, restoring the prior snapshot and persisting it. Null if empty. */
export async function undoPage(pageKey: string): Promise<PageAnnotations | null> {
  const state = getState(pageKey);
  const prev = state.undoStack.pop();
  if (!prev) return null;
  state.data = prev;
  await persist(pageKey);
  return cloneAnnotations(state.data);
}

/**
 * Re-anchor a loaded shape/pin against the current page's tagged elements: uid match first,
 * then selector match, then fall back to the shape's last-known rect/position unchanged (it
 * just won't track the element until it's re-tagged, e.g. by Select-clicking it again).
 */
export function reanchorElementAnchor<T extends { anchor: DesignShape['anchor'] }>(
  item: T,
  candidates: AnchorCandidate[],
): { candidate: AnchorCandidate | null; item: T } {
  const anchor = item.anchor;
  if (anchor.type !== 'element') return { candidate: null, item };
  const byUid = anchor.uid != null ? candidates.find((c) => c.uid === anchor.uid) : undefined;
  const bySelector = byUid ? undefined : candidates.find((c) => c.selector === anchor.selector);
  const candidate = byUid ?? bySelector ?? null;
  return { candidate, item };
}

/**
 * Re-anchor a shape's rect/points to a matched element's current rect (uid/selector fallback
 * handled by {@link reanchorElementAnchor}). Pen strokes and arrows keep their original relative
 * points — only rect/label shapes are re-fit to the element's new bounds.
 */
export function reanchorShape(shape: DesignShape, candidates: AnchorCandidate[]): DesignShape {
  const { candidate } = reanchorElementAnchor(shape, candidates);
  if (!candidate) return shape;
  if (shape.kind === 'rect' || shape.kind === 'label') {
    return { ...shape, rect: { ...candidate.rect } };
  }
  return shape;
}

/** Re-anchor a comment pin to a matched element's current position (top-left of its rect). */
export function reanchorPin(pin: CommentPin, candidates: AnchorCandidate[]): CommentPin {
  const { candidate } = reanchorElementAnchor(pin, candidates);
  if (!candidate) return pin;
  return { ...pin, x: candidate.rect.x, y: candidate.rect.y };
}

/**
 * Stamp shapes/pins with a link to the chat turn they were sent to (MIN-368), newest link
 * first. Mutates the in-memory page state directly (same pattern as addShape/eraseShape — no
 * network read-before-write, since the caller's target ids only exist if this page's shapes/
 * pins are already loaded/mutated in this session) and persists the result. No undo snapshot:
 * linking is send-time metadata, not a drawing edit users would want to "undo".
 */
export async function linkAnnotationsToTurn(
  pageKey: string,
  targets: { shapeIds?: string[]; pinIds?: string[] },
  link: { chatId: string; turnId: string },
): Promise<PageAnnotations | null> {
  if (!pageKey) return null;
  const shapeIds = new Set(targets.shapeIds ?? []);
  const pinIds = new Set(targets.pinIds ?? []);
  if (shapeIds.size === 0 && pinIds.size === 0) return null;

  const state = getState(pageKey);
  const entry: AnnotationLink = { chatId: link.chatId, turnId: link.turnId, at: Date.now() };
  state.data = {
    shapes: state.data.shapes.map((s) =>
      shapeIds.has(s.id) ? { ...s, links: [entry, ...(s.links ?? [])] } : s,
    ),
    pins: state.data.pins.map((p) =>
      pinIds.has(p.id) ? { ...p, links: [entry, ...(p.links ?? [])] } : p,
    ),
  };
  await persist(pageKey);
  return cloneAnnotations(state.data);
}

/**
 * Stamp every `designRef` attachment in a sent turn with a link to that chat turn (MIN-368).
 * This is the exact function tools/loop.ts's send path calls once the user message has been
 * pushed to history — `turnId` is the pushed message's history index (as a string), the same
 * identity {@link jumpToChatTurn}-style navigation and message-actions.ts already key off of.
 * `elementRef` picks (Select tool) have no annotation-store entry to link — only drawn
 * shapes (Draw tool) persist per-page, so only those participate in this link.
 */
export async function linkSentAttachmentsToTurn(
  chatId: string,
  turnId: string,
  attachments: Attachment[],
): Promise<void> {
  const shapeIdsByPage = new Map<string, string[]>();
  for (const att of attachments) {
    if (!isDesignRefAttachment(att)) continue;
    const shapeId = att.shape.id;
    if (!shapeId) continue;
    const list = shapeIdsByPage.get(att.pageUrl) ?? [];
    list.push(shapeId);
    shapeIdsByPage.set(att.pageUrl, list);
  }
  for (const [pageKey, shapeIds] of shapeIdsByPage) {
    await linkAnnotationsToTurn(pageKey, { shapeIds }, { chatId, turnId });
  }
}

/**
 * True when an element-anchored shape/pin's uid AND selector both fail to resolve against the
 * current page's tagged elements — the transcript "on-page" affordance and the annotations
 * panel render a moved/removed badge instead of a pulse highlight for these (MIN-368). Mirrors
 * {@link reanchorElementAnchor}'s uid-then-selector fallback; page-anchored items are never
 * "dead" (they always resolve to a bare page position).
 */
export function isAnchorDead(anchor: ShapeAnchor, candidates: AnchorCandidate[]): boolean {
  if (anchor.type !== 'element') return false;
  const byUid = anchor.uid != null ? candidates.find((c) => c.uid === anchor.uid) : undefined;
  const bySelector = byUid ? undefined : candidates.find((c) => c.selector === anchor.selector);
  return !byUid && !bySelector;
}

function rectsEqual(a: ShapeRect, b: ShapeRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export type AnchorHealStatus = 'healed' | 'dead' | 'unchanged';

export interface AnchorHealEntry {
  id: string;
  kind: 'shape' | 'pin';
  status: AnchorHealStatus;
}

export interface HealAnnotationsResult {
  data: PageAnnotations;
  entries: AnchorHealEntry[];
}

/**
 * Anchor healing ladder (MIN-370): re-run {@link reanchorShape}/{@link reanchorPin}'s uid→selector
 * resolution for every shape/pin on a page against its current live tagged elements.
 *  - 'dead' ({@link isAnchorDead}): uid AND selector both fail — caller renders the P5 stale
 *    badge (annotations-panel.ts already does this from `dead` on `AnnotationsPanelItem`).
 *  - 'healed': resolution succeeded and the rect/position moved — updated quietly, no badge.
 *  - 'unchanged': resolution succeeded at the same rect/position, or the anchor is page-type
 *    (page anchors are never dead and never move on their own).
 * Pure — no store/network I/O. {@link healPageAnnotations} is the persisting wrapper callers use
 * after an auto-reload settles.
 */
export function healAnnotations(
  data: PageAnnotations,
  candidates: AnchorCandidate[],
): HealAnnotationsResult {
  const entries: AnchorHealEntry[] = [];

  const shapes = data.shapes.map((shape) => {
    if (isAnchorDead(shape.anchor, candidates)) {
      entries.push({ id: shape.id, kind: 'shape', status: 'dead' });
      return shape;
    }
    const before = boundingRectOfShape(shape);
    const healed = reanchorShape(shape, candidates);
    const after = boundingRectOfShape(healed);
    entries.push({ id: shape.id, kind: 'shape', status: rectsEqual(before, after) ? 'unchanged' : 'healed' });
    return healed;
  });

  const pins = data.pins.map((pin) => {
    if (isAnchorDead(pin.anchor, candidates)) {
      entries.push({ id: pin.id, kind: 'pin', status: 'dead' });
      return pin;
    }
    const healed = reanchorPin(pin, candidates);
    const status: AnchorHealStatus = pin.x === healed.x && pin.y === healed.y ? 'unchanged' : 'healed';
    entries.push({ id: pin.id, kind: 'pin', status });
    return healed;
  });

  return { data: { shapes, pins }, entries };
}

/**
 * Persisting wrapper around {@link healAnnotations}: loads the page (cached after first call),
 * heals every shape/pin against `candidates`, persists the healed rects/positions, and returns
 * the classification so the caller can refresh dead badges (annotations panel) without a badge
 * flicker for the common "nothing moved" case.
 */
export async function healPageAnnotations(
  pageKey: string,
  candidates: AnchorCandidate[],
): Promise<HealAnnotationsResult> {
  if (!pageKey) return { data: emptyAnnotations(), entries: [] };
  await loadPageAnnotations(pageKey);
  const state = getState(pageKey);
  const result = healAnnotations(state.data, candidates);
  state.data = result.data;
  await persist(pageKey);
  return { data: cloneAnnotations(result.data), entries: result.entries };
}

/** New anchor target for {@link repickAnnotation} — the freshly picked element's identity/rect. */
export interface RepickAnchorInput {
  uid: number | null;
  selector: string;
  rect: ShapeRect;
}

/**
 * One-click re-pick (MIN-370): move a dead shape/pin's anchor onto a freshly picked element,
 * keeping its `links[]` (P5 chat linking) untouched — re-picking re-anchors, it doesn't create a
 * new mark. `annotationId` is matched against both shapes and pins (ids are namespaced
 * `dshape-`/`dpin-` by shape-model.ts, so there's no ambiguity). Returns null when no shape/pin
 * with that id exists on the page (nothing to persist).
 */
export async function repickAnnotation(
  pageKey: string,
  annotationId: string,
  newAnchor: RepickAnchorInput,
): Promise<PageAnnotations | null> {
  if (!pageKey || !annotationId) return null;
  await loadPageAnnotations(pageKey);
  const state = getState(pageKey);

  const hasShape = state.data.shapes.some((s) => s.id === annotationId);
  const hasPin = state.data.pins.some((p) => p.id === annotationId);
  if (!hasShape && !hasPin) return null;

  const anchor: ShapeAnchor = { type: 'element', uid: newAnchor.uid, selector: newAnchor.selector };
  pushUndoSnapshot(pageKey);
  state.data = {
    shapes: state.data.shapes.map((shape) => {
      if (shape.id !== annotationId) return shape;
      const next: DesignShape = { ...shape, anchor };
      if (shape.kind === 'rect' || shape.kind === 'label') next.rect = { ...newAnchor.rect };
      return next;
    }),
    pins: state.data.pins.map((pin) =>
      pin.id === annotationId ? { ...pin, anchor, x: newAnchor.rect.x, y: newAnchor.rect.y } : pin,
    ),
  };
  await persist(pageKey);
  return cloneAnnotations(state.data);
}

/** Test helper — clear all in-memory page state between cases. */
export function resetAnnotationStoreForTests(): void {
  pages.clear();
}
