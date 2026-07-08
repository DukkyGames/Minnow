/**
 * DesignTool plug-in contract (MIN-365) — the shape P3/P4 tools (Select, Draw, Comment,
 * Inspect) implement to arm/disarm against a Design Mode session and receive overlay-space
 * pointer events. This module only owns the contract + a process-wide registry; mounting,
 * pointer capture, and dispatch live in design-mode.ts.
 */

import type { AnnotationOverlay, OverlayMarker } from './overlay';
import {
  createElementPicker,
  createPickerTransport,
  uidFallbackSelector,
  type ElementPicker,
  type PickedElement,
  type PickerTransport,
} from './element-picker';
import { captureRegion, captureRegionWithOverlay } from './region-capture';
import { resolveElementSourceMapping } from './source-map';
import { addElementRefToComposer } from '../attachments/element-ref';
import { addDesignRefToComposer } from '../attachments/design-ref';
import { updateAttachmentSourceMapping } from '../attachments/store';
import { getFilePanelState } from '../state/file-panel';
import {
  boundingRectOfShape,
  newPinId,
  newShapeId,
  resolveShapeAnchor,
  thinPoints,
  type AnchorCandidate,
  type CommentPin,
  type DesignShape,
  type ShapeKind,
  type ShapePoint,
} from './shape-model';
import {
  addPin as persistPin,
  addNoteToPin as persistNote,
  addShape as persistShape,
  erasePin as erasePinAnnotation,
  eraseShape as eraseShapeAnnotation,
  loadPageAnnotations,
  undoPage,
} from './annotation-store';

/** Shared context handed to a tool when it becomes the armed tool. */
export interface DesignToolContext {
  /** The preview instance this session is attached to (e.g. 'workspace-preview', 'design'). */
  instanceId: string;
  /** The host element the overlay/strip are mounted into (e.g. #previewBody). */
  host: HTMLElement;
  /** The mounted annotation overlay — tools draw via overlay.render()/mapGuestRect(). */
  overlay: AnnotationOverlay;
}

/** Pointer event in overlay/host-space (CSS px, origin at the host's top-left). */
export interface DesignToolPointerEvent {
  x: number;
  y: number;
  raw: PointerEvent;
}

/**
 * Plug-in contract for a Design Mode tool. Registered once via registerDesignTool(); armed/
 * disarmed exclusively (only one tool is armed at a time) by design-mode.ts.
 */
export interface DesignTool {
  id: string;
  label: string;
  /** Called when this tool becomes the armed tool. Pointer capture is already enabled. */
  arm(ctx: DesignToolContext): void;
  /** Called when this tool stops being the armed tool (Esc, switching tools, mode off). */
  disarm(): void;
  onPointerDown?(evt: DesignToolPointerEvent): void;
  onPointerMove?(evt: DesignToolPointerEvent): void;
  onPointerUp?(evt: DesignToolPointerEvent): void;
  /** Optional explicit re-render hook (e.g. after external state change while armed). */
  render?(): void;
}

const registry = new Map<string, DesignTool>();

/** Register (or replace) a tool by id. Last registration for a given id wins. */
export function registerDesignTool(tool: DesignTool): void {
  registry.set(tool.id, tool);
}

export function unregisterDesignTool(id: string): void {
  registry.delete(id);
}

export function getDesignTool(id: string): DesignTool | undefined {
  return registry.get(id);
}

export function listDesignTools(): DesignTool[] {
  return [...registry.values()];
}

/** Test helper — clear all registered tools between cases. */
export function resetDesignToolRegistryForTests(): void {
  registry.clear();
}

/**
 * Page the current preview is showing: workspace path or URL (elementRef context). Exported
 * (MIN-368) so the annotations panel / preview-panel.ts toolbar can key annotation-store
 * lookups off the same page identity Draw/Comment tools already persist under.
 */
export function currentPreviewPageRef(): string {
  const source = getFilePanelState().previewSource;
  if (!source) return '';
  return source.kind === 'workspace' ? source.path : source.url;
}

/**
 * Real Select tool (MIN-366): arms the P0 element picker (element-picker.ts), captures a
 * DPR-correct crop per pick via region-capture.ts, and pushes an `elementRef` composer chip
 * (attachments/element-ref.ts). Picks accumulate as numbered overlay markers with pinned crop
 * thumbnails; dedupe by page + uid is handled by addElementRefToComposer itself, so re-picking
 * the same element (shift-click or not) just re-focuses the existing chip.
 */
export function createSelectDesignTool(): DesignTool {
  let ctx: DesignToolContext | null = null;
  let picker: ElementPicker | null = null;
  let transport: PickerTransport | null = null;
  let markers: OverlayMarker[] = [];

  function resetSelection(): void {
    markers = [];
    ctx?.overlay.clear();
  }

  async function handlePick(picked: PickedElement): Promise<void> {
    if (!ctx) return;
    const selector =
      picked.cssSelector || (picked.uid != null ? uidFallbackSelector(picked.uid) : '');
    if (!selector) return;

    const captured = await captureRegion({
      selector,
      boundingRect: picked.boundingRect,
      devicePixelRatio: picked.devicePixelRatio,
    });

    const attachment = addElementRefToComposer({
      selector,
      uid: picked.uid,
      pageUrl: currentPreviewPageRef(),
      tagName: picked.tagName,
      classList: picked.classList,
      outerHtmlPreview: picked.outerHTMLPreview,
      rect: picked.boundingRect,
      stylesDigest: picked.stylesDigest,
      croppedDataUrl: captured.dataUrl,
    });
    if (!attachment || !ctx) return;

    const markerId = attachment.id;
    if (!markers.some((marker) => marker.id === markerId)) {
      const rect = ctx.overlay.mapGuestRect(picked.boundingRect, picked.devicePixelRatio);
      markers.push({ id: markerId, index: markers.length + 1, rect });
    }
    ctx.overlay.render(markers);
    if (captured.dataUrl) ctx.overlay.pinCaptureToMarker(markerId, captured);

    // Source resolution (MIN-369) runs after the chip is already on screen — never delays or
    // blocks the pick itself. Best-effort: resolveElementSourceMapping never rejects.
    const armedTransport = transport;
    void resolveElementSourceMapping(
      {
        selector,
        pageUrl: currentPreviewPageRef(),
        tagName: picked.tagName,
        classList: picked.classList,
        outerHtmlPreview: picked.outerHTMLPreview,
      },
      armedTransport,
    ).then((mapping) => {
      updateAttachmentSourceMapping(attachment.id, mapping);
    });
  }

  return {
    id: 'select',
    label: 'Select',
    arm(context) {
      ctx = context;
      resetSelection();
      transport = createPickerTransport();
      picker = createElementPicker({
        transport,
        onPick: (picked) => void handlePick(picked),
      });
      void picker.enable().catch(() => {});
    },
    disarm() {
      void picker?.disable();
      picker?.destroy();
      picker = null;
      transport = null;
      resetSelection();
      ctx = null;
    },
    render() {
      ctx?.overlay.render(markers);
    },
  };
}

const TAGGED_ELEMENTS_SCRIPT = `(() => {
  const els = Array.from(document.querySelectorAll('[data-mn-uid]'));
  return els.map((el) => {
    const uid = Number(el.getAttribute('data-mn-uid'));
    const r = el.getBoundingClientRect();
    return { uid, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  });
})()`;

function getPreviewFrame(): HTMLIFrameElement | null {
  return document.getElementById('previewFrame') as HTMLIFrameElement | null;
}

/**
 * Draw/Comment anchor resolution (MIN-367): already-tagged `data-mn-uid` elements in the guest,
 * for {@link resolveShapeAnchor} to hit-test a drawn shape's region against. Best-effort — an
 * empty list just means every shape/pin anchors to the page instead of an element. Exported
 * (MIN-368) so annotation-nav.ts's transcript → page re-highlight can reuse the same live-guest
 * read instead of re-implementing it.
 */
export async function gatherAnchorCandidates(): Promise<AnchorCandidate[]> {
  const transport = createPickerTransport();
  try {
    if (transport.mode === 'iframe') {
      const doc = getPreviewFrame()?.contentDocument;
      if (!doc) return [];
      return Array.from(doc.querySelectorAll('[data-mn-uid]')).map((el) => {
        const uid = Number(el.getAttribute('data-mn-uid'));
        const r = el.getBoundingClientRect();
        return {
          uid,
          selector: uidFallbackSelector(uid),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      });
    }
    const raw = await transport.eval(TAGGED_ELEMENTS_SCRIPT);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((row): row is { uid: number; rect: AnchorCandidate['rect'] } => {
        return (
          row != null &&
          typeof row === 'object' &&
          typeof (row as { uid?: unknown }).uid === 'number' &&
          (row as { rect?: unknown }).rect != null
        );
      })
      .map((row) => ({ uid: row.uid, selector: uidFallbackSelector(row.uid), rect: row.rect }));
  } catch {
    return [];
  }
}

function guestScrollOffset(): { x: number; y: number } {
  const frame = getPreviewFrame();
  const view = frame?.contentWindow;
  if (view) {
    return { x: view.scrollX || 0, y: view.scrollY || 0 };
  }
  return { x: window.scrollX || 0, y: window.scrollY || 0 };
}

/** Draw tool factory return type — exposes shape-kind switching and eraser/undo for the strip. */
export interface DrawDesignTool extends DesignTool {
  setShapeKind(kind: ShapeKind): void;
  getShapeKind(): ShapeKind;
  getShapes(): DesignShape[];
  eraseShape(shapeId: string): void;
  undo(): void;
}

/**
 * Real Draw tool (MIN-367): pen/rect/arrow/label shapes drawn directly on the live page.
 * Pointer events arrive in host-space (design-mode.ts's capture layer); each finished shape is
 * anchored (element vs. page), persisted per-page (annotation-store.ts), rendered into the
 * overlay's shape layer, and pushed to the composer as its own `designRef` chip with a
 * composited region crop + structured intent text (design-ref.ts).
 */
export function createDrawDesignTool(): DrawDesignTool {
  let ctx: DesignToolContext | null = null;
  let kind: ShapeKind = 'rect';
  let shapes: DesignShape[] = [];
  let pageKey = '';
  let dragStart: ShapePoint | null = null;
  let penPoints: ShapePoint[] = [];

  function renderShapes(): void {
    // Dynamic import avoids a static cycle (annotation-nav.ts calls back into this module's
    // gatherAnchorCandidates for the transcript → page direction).
    ctx?.overlay.renderShapes(shapes, (shapeId) => {
      const shape = shapes.find((s) => s.id === shapeId);
      const link = shape?.links?.[0];
      if (!link) return;
      void import('./annotation-nav').then((m) => m.jumpToChatTurn(link.chatId, link.turnId));
    });
  }

  async function finalizeShape(partial: Pick<DesignShape, 'kind' | 'points' | 'rect' | 'label'>): Promise<void> {
    const armedCtx = ctx;
    if (!armedCtx) return;
    const draft: DesignShape = {
      id: '',
      anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 },
      createdAt: 0,
      ...partial,
    };
    const rect = boundingRectOfShape(draft);
    const [candidates, scroll] = await Promise.all([
      gatherAnchorCandidates(),
      Promise.resolve(guestScrollOffset()),
    ]);
    if (ctx !== armedCtx) return; // torn down while awaiting
    const anchor = resolveShapeAnchor(rect, candidates, {
      x: rect.x,
      y: rect.y,
      scrollX: scroll.x,
      scrollY: scroll.y,
    });
    const shape: DesignShape = { ...draft, id: newShapeId(), anchor, createdAt: Date.now() };
    shapes = [...shapes, shape];
    renderShapes();
    void persistShape(pageKey, shape);

    const svgMarkup = armedCtx.overlay.getSvgMarkup();
    const dpr = window.devicePixelRatio || 1;
    const selector = anchor.type === 'element' ? anchor.selector : `page@${Math.round(rect.x)},${Math.round(rect.y)}`;
    try {
      const captured = await captureRegionWithOverlay(
        { selector, boundingRect: rect, devicePixelRatio: dpr },
        svgMarkup,
      );
      addDesignRefToComposer({ shape, pageUrl: pageKey, compositedDataUrl: captured.dataUrl });
    } catch {
      addDesignRefToComposer({ shape, pageUrl: pageKey });
    }
  }

  return {
    id: 'draw',
    label: 'Draw',
    arm(context) {
      ctx = context;
      shapes = [];
      dragStart = null;
      penPoints = [];
      pageKey = currentPreviewPageRef();
      void loadPageAnnotations(pageKey).then((data) => {
        if (ctx !== context) return;
        shapes = data.shapes;
        renderShapes();
      });
    },
    disarm() {
      ctx?.overlay.renderShapes([]);
      ctx = null;
      shapes = [];
      dragStart = null;
      penPoints = [];
    },
    onPointerDown(evt) {
      dragStart = { x: evt.x, y: evt.y };
      if (kind === 'pen') penPoints = [{ x: evt.x, y: evt.y }];
    },
    onPointerMove(evt) {
      if (!dragStart) return;
      if (kind === 'pen') penPoints.push({ x: evt.x, y: evt.y });
    },
    onPointerUp(evt) {
      if (!dragStart) return;
      const start = dragStart;
      dragStart = null;
      const end = { x: evt.x, y: evt.y };

      if (kind === 'rect') {
        const rect = {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
        };
        if (rect.width < 4 && rect.height < 4) return;
        void finalizeShape({ kind: 'rect', rect });
        return;
      }

      if (kind === 'arrow') {
        if (Math.hypot(end.x - start.x, end.y - start.y) < 4) return;
        void finalizeShape({ kind: 'arrow', points: [start, end] });
        return;
      }

      if (kind === 'pen') {
        const raw = penPoints.length >= 2 ? penPoints : [start, end];
        penPoints = [];
        const thinned = thinPoints(raw);
        if (thinned.length < 2) return;
        void finalizeShape({ kind: 'pen', points: thinned });
        return;
      }

      if (kind === 'label') {
        const text =
          typeof window !== 'undefined' && typeof window.prompt === 'function'
            ? window.prompt('Label text')?.trim()
            : '';
        if (!text) return;
        const rect = { x: start.x, y: start.y - 10, width: Math.max(24, text.length * 7 + 12), height: 20 };
        void finalizeShape({ kind: 'label', rect, label: text });
      }
    },
    render() {
      renderShapes();
    },
    setShapeKind(next) {
      kind = next;
    },
    getShapeKind() {
      return kind;
    },
    getShapes() {
      return [...shapes];
    },
    eraseShape(shapeId) {
      shapes = shapes.filter((s) => s.id !== shapeId);
      renderShapes();
      void eraseShapeAnnotation(pageKey, shapeId);
    },
    undo() {
      void undoPage(pageKey).then((data) => {
        if (!data) return;
        shapes = data.shapes;
        renderShapes();
      });
    },
  };
}

/** Comment tool factory return type — exposes pin/note access for the strip's thread popover. */
export interface CommentDesignTool extends DesignTool {
  getPins(): CommentPin[];
  addNote(pinId: string, text: string): Promise<void>;
  erasePin(pinId: string): void;
  undo(): void;
}

/**
 * Real Comment tool (MIN-367): click drops a numbered pin anchored like a draw shape; each pin
 * threads plain-text notes (with timestamps) in a small popover. Pins persist per-page via
 * annotation-store.ts — no chat/composer coupling (comments are markup, not chat turns).
 */
export function createCommentDesignTool(): CommentDesignTool {
  let ctx: DesignToolContext | null = null;
  let pins: CommentPin[] = [];
  let pageKey = '';
  let popover: HTMLElement | null = null;

  function closePopover(): void {
    popover?.remove();
    popover = null;
  }

  function renderPins(): void {
    ctx?.overlay.renderPins(pins, (pinId) => {
      const pin = pins.find((p) => p.id === pinId);
      if (pin) openPopover(pin);
    });
  }

  function openPopover(pin: CommentPin): void {
    if (!ctx) return;
    closePopover();
    const panel = document.createElement('div');
    panel.className = 'mn-design-pin-popover';
    panel.style.cssText = `position:absolute;left:${Math.round(pin.x) + 14}px;top:${Math.round(pin.y)}px;z-index:5;`;

    const list = document.createElement('div');
    list.className = 'mn-design-pin-popover__notes';
    for (const note of pin.notes) {
      const row = document.createElement('div');
      row.className = 'mn-design-pin-popover__note';
      row.textContent = note.text;
      list.appendChild(row);
    }
    panel.appendChild(list);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mn-design-pin-popover__input';
    input.placeholder = 'Add a note…';
    panel.appendChild(input);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'mn-design-pin-popover__add';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      void addNoteInternal(pin.id, text);
    });
    panel.appendChild(addBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mn-design-pin-popover__close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => closePopover());
    panel.appendChild(closeBtn);

    ctx.host.appendChild(panel);
    popover = panel;
  }

  async function addNoteInternal(pinId: string, text: string): Promise<void> {
    const armedCtx = ctx;
    const data = await persistNote(pageKey, pinId, text);
    if (!data || ctx !== armedCtx) return;
    pins = data.pins;
    renderPins();
    const refreshed = pins.find((p) => p.id === pinId);
    if (refreshed) openPopover(refreshed);
  }

  return {
    id: 'comment',
    label: 'Comment',
    arm(context) {
      ctx = context;
      pins = [];
      pageKey = currentPreviewPageRef();
      void loadPageAnnotations(pageKey).then((data) => {
        if (ctx !== context) return;
        pins = data.pins;
        renderPins();
      });
    },
    disarm() {
      closePopover();
      ctx?.overlay.renderPins([]);
      ctx = null;
      pins = [];
    },
    onPointerUp(evt) {
      const armedCtx = ctx;
      if (!armedCtx) return;
      void (async () => {
        const rect = { x: evt.x - 1, y: evt.y - 1, width: 2, height: 2 };
        const [candidates, scroll] = await Promise.all([
          gatherAnchorCandidates(),
          Promise.resolve(guestScrollOffset()),
        ]);
        if (ctx !== armedCtx) return;
        const anchor = resolveShapeAnchor(rect, candidates, {
          x: evt.x,
          y: evt.y,
          scrollX: scroll.x,
          scrollY: scroll.y,
        });
        const pin: CommentPin = { id: newPinId(), index: pins.length + 1, x: evt.x, y: evt.y, anchor, notes: [] };
        pins = [...pins, pin];
        renderPins();
        void persistPin(pageKey, pin);
        openPopover(pin);
      })();
    },
    render() {
      renderPins();
    },
    getPins() {
      return [...pins];
    },
    async addNote(pinId, text) {
      await addNoteInternal(pinId, text);
    },
    erasePin(pinId) {
      pins = pins.filter((p) => p.id !== pinId);
      renderPins();
      if (popover) closePopover();
      void erasePinAnnotation(pageKey, pinId);
    },
    undo() {
      void undoPage(pageKey).then((data) => {
        if (!data) return;
        pins = data.pins;
        renderPins();
      });
    },
  };
}

/** Ids the built-in tool strip renders buttons for; P3/P4 implement the real behavior. */
export const BUILTIN_DESIGN_TOOL_IDS = ['select', 'draw', 'comment', 'inspect'] as const;
export type BuiltinDesignToolId = (typeof BUILTIN_DESIGN_TOOL_IDS)[number];

/**
 * A minimal placeholder tool: arms/disarms and records events but draws nothing. Used both to
 * back the built-in tool-strip buttons until P3/P4 land real behavior, and as the stub the
 * DesignTool contract is exercised against in tests.
 */
export interface PlaceholderDesignToolHandle {
  tool: DesignTool;
  isArmed(): boolean;
  getContext(): DesignToolContext | null;
  /** Chronological log of dispatched events, e.g. 'arm', 'down:12,34', 'disarm'. */
  getEvents(): string[];
  resetEvents(): void;
}

export function createPlaceholderDesignTool(
  id: string,
  label = id,
): PlaceholderDesignToolHandle {
  let armed = false;
  let ctx: DesignToolContext | null = null;
  const events: string[] = [];

  const tool: DesignTool = {
    id,
    label,
    arm(context) {
      armed = true;
      ctx = context;
      events.push('arm');
    },
    disarm() {
      armed = false;
      ctx = null;
      events.push('disarm');
    },
    onPointerDown(evt) {
      events.push(`down:${evt.x},${evt.y}`);
    },
    onPointerMove(evt) {
      events.push(`move:${evt.x},${evt.y}`);
    },
    onPointerUp(evt) {
      events.push(`up:${evt.x},${evt.y}`);
    },
    render() {
      events.push('render');
    },
  };

  return {
    tool,
    isArmed: () => armed,
    getContext: () => ctx,
    getEvents: () => [...events],
    resetEvents: () => {
      events.length = 0;
    },
  };
}

/** The stub tool id used by tests to exercise the registry/arm/disarm/pointer contract. */
export const STUB_DESIGN_TOOL_ID = 'stub';

export function createStubDesignTool(): PlaceholderDesignToolHandle {
  return createPlaceholderDesignTool(STUB_DESIGN_TOOL_ID, 'Stub');
}

/** Register placeholder tools for the four built-in strip buttons (idempotent). */
export function registerBuiltinPlaceholderDesignTools(): void {
  for (const id of BUILTIN_DESIGN_TOOL_IDS) {
    if (!registry.has(id)) {
      registerDesignTool(createPlaceholderDesignTool(id).tool);
    }
  }
}
