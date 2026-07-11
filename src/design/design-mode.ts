/**
 * Design Mode toggle & overlay framework (MIN-365).
 *
 * Enabling Design Mode for a preview instance mounts a transparent SVG overlay
 * (src/design/overlay.ts) plus a slim tool strip as siblings inside the host element (the same
 * element the guest's native/iframe bounds are read from — #previewBody for the workspace
 * instance) and leaves the guest itself untouched. The overlay tracks the guest rect for free
 * via its own ResizeObserver; nothing here needs to duplicate that.
 *
 * Pointer events pass through to the guest (scroll/click/nav/auto-reload keep working) unless a
 * DesignTool is armed, in which case a dedicated capture layer intercepts pointer events and
 * dispatches them to the armed tool in host-space coordinates.
 */

import { createAnnotationOverlay, type AnnotationOverlay } from './overlay';
import {
  getDesignTool,
  registerBuiltinPlaceholderDesignTools,
  registerDesignTool,
  createSelectDesignTool,
  createDrawDesignTool,
  createCommentDesignTool,
  clearAllDesignModeMarks,
  type BuiltinDesignToolId,
  type DesignTool,
  type DesignToolContext,
  type DesignToolPointerEvent,
  type DrawDesignTool,
  type SelectDesignTool,
} from './design-tool';
import { createPickerTransport } from './element-picker';
import type { ShapeKind } from './shape-model';
import {
  DEFAULT_DESIGN_INSTANCE_META,
  loadDesignInstanceMeta,
  saveDesignInstanceMeta,
  type DesignInstanceMeta,
  type DesignViewportPreset,
} from '../config/design-meta';

const STRIP_CLASS = 'mn-design-strip';
const CAPTURE_CLASS = 'mn-design-capture';
const VIEWPORT_CLASS_PREFIX = 'mn-design-viewport--';
const DARK_EMULATION_CLASS = 'mn-design-dark-emulation';

const VIEWPORT_WIDTHS: Record<DesignViewportPreset, number | null> = {
  mobile: 375,
  tablet: 768,
  desktop: null,
};

export interface DesignModeMountOptions {
  /** Preview instance this session is attached to (design-meta.ts key, e.g. 'workspace-preview'). */
  instanceId: string;
  /** Host element the overlay/strip mount into — must be the guest's bounds-source element. */
  host: HTMLElement;
  /**
   * @deprecated Strip relocation is handled by preview-panel (`relocateDesignModeStrip`).
   * The strip always mounts in `host` first.
   */
  chromeHost?: HTMLElement;
  /** Keyboard-shortcut scope; defaults to `host` when omitted. */
  paneElement?: HTMLElement;
  /**
   * Called when the user exits Design Mode from the strip's close button. Hosts that own extra
   * teardown (toolbar toggle state, Electron guest swap) pass their own toggle here; when
   * omitted the strip falls back to disableDesignMode(instanceId).
   */
  onExit?: () => void;
  /**
   * Called with the newly-armed tool id (or null on disarm) whenever the armed tool changes.
   * The Electron host uses this to pick the guest strategy on cross-origin previews: element
   * Select needs the native WebContentsView visible for CDP inspect, while Draw/Comment want
   * the iframe guest so their DOM overlay stacks on top. Fired on both user arms and the
   * persisted-tool restore during enable.
   */
  onArmedToolChange?: (toolId: string | null) => void | Promise<void>;
  /** Called after the strip's Clear all button wipes marks on the current page (host refreshes panel). */
  onClearAll?: () => void;
}

export interface DesignModeSession {
  readonly instanceId: string;
  readonly host: HTMLElement;
  readonly overlay: AnnotationOverlay;
  strip: HTMLElement;
  armTool(id: string): void;
  disarmTool(): void;
  getArmedToolId(): string | null;
  setViewportPreset(preset: DesignViewportPreset): void;
  getViewportPreset(): DesignViewportPreset;
  setDarkModeEmulation(on: boolean): void;
  getDarkModeEmulation(): boolean;
  clearAll(): Promise<void>;
  destroy(): void;
}

interface InternalSession extends DesignModeSession {
  captureLayer: HTMLElement;
  armedTool: DesignTool | null;
  armedToolId: string | null;
  onExit?: () => void;
  onClearAll?: () => void;
}

const sessions = new Map<string, InternalSession>();

export function isDesignModeEnabled(instanceId: string): boolean {
  return sessions.has(instanceId);
}

export function getDesignModeSession(instanceId: string): DesignModeSession | undefined {
  return sessions.get(instanceId);
}

/**
 * Re-bind the Select tool's picker after the preview guest reloads or swaps between the iframe
 * and native WebContentsView (workspace HTML auto-reload, arming Select on a cross-origin URL).
 */
export function refreshDesignModeArmedToolGuest(instanceId: string): void {
  const session = sessions.get(instanceId);
  if (!session || session.armedToolId !== 'select' || !session.armedTool) return;
  const refresh = (session.armedTool as SelectDesignTool).refreshGuestBinding;
  if (typeof refresh === 'function') refresh();
}

/** Move the tool strip between #previewBody (overlay) and #previewDesignChrome (Electron footer). */
export function relocateDesignModeStrip(instanceId: string, stripHost: HTMLElement): void {
  const session = sessions.get(instanceId);
  if (!session || session.strip.parentElement === stripHost) return;
  stripHost.appendChild(session.strip);
}

/** Host-space pointer coordinates (CSS px), matching overlay.ts's own local-point mapping. */
function localPoint(host: HTMLElement, ev: PointerEvent): { x: number; y: number } {
  const rect = host.getBoundingClientRect();
  const contentWidth = host.clientWidth || rect.width;
  const scale = contentWidth ? rect.width / contentWidth || 1 : 1;
  return {
    x: (ev.clientX - rect.left) / scale,
    y: (ev.clientY - rect.top) / scale,
  };
}

function toToolEvent(host: HTMLElement, ev: PointerEvent): DesignToolPointerEvent {
  const { x, y } = localPoint(host, ev);
  return { x, y, raw: ev };
}

/**
 * Pass-through unless a capture-mode tool is armed — this is the whole "leave the guest
 * untouched" contract. Passthrough tools (Select) keep the guest interactive: their picker
 * listens inside the guest document and would never see a click this layer swallowed.
 */
function applyCaptureMode(session: InternalSession): void {
  const captures = Boolean(session.armedTool) && session.armedTool?.pointerMode !== 'passthrough';
  session.captureLayer.style.pointerEvents = captures ? 'auto' : 'none';
  session.captureLayer.style.cursor = captures ? 'crosshair' : '';
}

function buildCaptureLayer(host: HTMLElement, session: InternalSession): HTMLElement {
  const layer = document.createElement('div');
  layer.className = CAPTURE_CLASS;
  layer.style.cssText = 'position:absolute;inset:0;z-index:3;pointer-events:none;';

  const onPointerDown = (ev: PointerEvent): void => {
    // Keep the drag alive when the pointer leaves the host mid-stroke; without capture the
    // pointerup lands elsewhere and the tool's drag state sticks.
    if (typeof layer.setPointerCapture === 'function') {
      try {
        layer.setPointerCapture(ev.pointerId);
      } catch {
        /* pointer may already be gone */
      }
    }
    session.armedTool?.onPointerDown?.(toToolEvent(host, ev));
  };
  const onPointerMove = (ev: PointerEvent): void => {
    session.armedTool?.onPointerMove?.(toToolEvent(host, ev));
  };
  const onPointerUp = (ev: PointerEvent): void => {
    if (typeof layer.releasePointerCapture === 'function') {
      try {
        layer.releasePointerCapture(ev.pointerId);
      } catch {
        /* not captured */
      }
    }
    session.armedTool?.onPointerUp?.(toToolEvent(host, ev));
  };

  layer.addEventListener('pointerdown', onPointerDown);
  layer.addEventListener('pointermove', onPointerMove);
  layer.addEventListener('pointerup', onPointerUp);
  layer.addEventListener('pointercancel', onPointerUp);

  host.appendChild(layer);
  return layer;
}

/** Tool ids the strip renders buttons for. Inspect stays registry-only until it does something. */
const STRIP_TOOL_IDS = ['select', 'draw', 'comment'] as const satisfies readonly BuiltinDesignToolId[];

const DRAW_SHAPE_KINDS: readonly ShapeKind[] = ['rect', 'pen', 'arrow', 'label'];

/** Stroke-icon markup (24 viewBox, currentColor) matching the app's toolbar icon style. */
const STRIP_ICONS: Record<string, string> = {
  select: '<path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/>',
  draw: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  comment:
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  mobile: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
  desktop: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  exit: '<path d="M18 6L6 18M6 6l12 12"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  clear:
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
  pen: '<path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  arrow: '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
  label: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
};

function stripButton(icon: string, label: string, className = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `${STRIP_CLASS}__btn${className ? ` ${className}` : ''}`;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STRIP_ICONS[icon] ?? ''}</svg>`;
  return btn;
}

function stripSeparator(): HTMLElement {
  const sep = document.createElement('span');
  sep.className = `${STRIP_CLASS}__sep`;
  sep.setAttribute('aria-hidden', 'true');
  return sep;
}

function toolButtonLabel(id: string): string {
  switch (id) {
    case 'select':
      return 'Select element (V)';
    case 'draw':
      return 'Draw (P)';
    case 'comment':
      return 'Comment (C)';
    default:
      return id;
  }
}

function shapeKindLabel(kind: ShapeKind): string {
  switch (kind) {
    case 'rect':
      return 'Rectangle';
    case 'pen':
      return 'Freehand pen';
    case 'arrow':
      return 'Arrow';
    case 'label':
      return 'Text label';
  }
}

function getDrawTool(): DrawDesignTool | null {
  const tool = getDesignTool('draw');
  if (tool && typeof (tool as DrawDesignTool).setShapeKind === 'function') {
    return tool as DrawDesignTool;
  }
  return null;
}

function buildStrip(session: InternalSession): HTMLElement {
  const strip = document.createElement('div');
  strip.className = STRIP_CLASS;
  strip.setAttribute('role', 'toolbar');
  strip.setAttribute('aria-label', 'Design Mode tools');

  const row = document.createElement('div');
  row.className = `${STRIP_CLASS}__row`;
  strip.appendChild(row);

  const tools = document.createElement('div');
  tools.className = `${STRIP_CLASS}__tools`;
  for (const id of STRIP_TOOL_IDS) {
    const btn = stripButton(id, toolButtonLabel(id));
    btn.dataset.tool = id;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      if (session.armedToolId === id) session.disarmTool();
      else session.armTool(id);
    });
    tools.appendChild(btn);
  }
  row.appendChild(tools);
  row.appendChild(stripSeparator());

  const viewportGroup = document.createElement('div');
  viewportGroup.className = `${STRIP_CLASS}__viewports`;
  (['mobile', 'tablet', 'desktop'] as DesignViewportPreset[]).forEach((preset) => {
    const label =
      preset === 'desktop'
        ? 'Desktop (full width)'
        : `${preset[0]!.toUpperCase()}${preset.slice(1)} (${VIEWPORT_WIDTHS[preset]}px)`;
    const btn = stripButton(preset, label);
    btn.dataset.viewport = preset;
    btn.setAttribute('aria-pressed', String(preset === session.getViewportPreset()));
    btn.addEventListener('click', () => session.setViewportPreset(preset));
    viewportGroup.appendChild(btn);
  });
  row.appendChild(viewportGroup);
  row.appendChild(stripSeparator());

  const darkToggle = stripButton('dark', 'Emulate dark mode', `${STRIP_CLASS}__dark-toggle`);
  darkToggle.setAttribute('aria-pressed', String(session.getDarkModeEmulation()));
  darkToggle.addEventListener('click', () =>
    session.setDarkModeEmulation(!session.getDarkModeEmulation()),
  );
  row.appendChild(darkToggle);
  row.appendChild(stripSeparator());

  const clearAllBtn = stripButton(
    'clear',
    'Clear all marks',
    `${STRIP_CLASS}__clear-all`,
  );
  clearAllBtn.addEventListener('click', () => {
    void session.clearAll();
  });
  row.appendChild(clearAllBtn);
  row.appendChild(stripSeparator());

  const exitBtn = stripButton('exit', 'Exit Design Mode', `${STRIP_CLASS}__exit`);
  exitBtn.addEventListener('click', () => {
    if (session.onExit) session.onExit();
    else disableDesignMode(session.instanceId);
  });
  row.appendChild(exitBtn);

  // Draw sub-tools (shape kind + undo) — only visible while the Draw tool is armed.
  const sub = document.createElement('div');
  sub.className = `${STRIP_CLASS}__sub`;
  sub.hidden = true;
  for (const kind of DRAW_SHAPE_KINDS) {
    const btn = stripButton(kind, shapeKindLabel(kind));
    btn.dataset.shapeKind = kind;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      getDrawTool()?.setShapeKind(kind);
      syncStripState(session);
    });
    sub.appendChild(btn);
  }
  sub.appendChild(stripSeparator());
  const undoBtn = stripButton('undo', 'Undo last mark', `${STRIP_CLASS}__undo`);
  undoBtn.addEventListener('click', () => getDrawTool()?.undo());
  sub.appendChild(undoBtn);
  strip.appendChild(sub);

  return strip;
}

function syncStripState(session: InternalSession): void {
  const toolButtons = session.strip.querySelectorAll<HTMLButtonElement>('[data-tool]');
  toolButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.tool === session.armedToolId));
  });
  const viewportButtons = session.strip.querySelectorAll<HTMLButtonElement>('[data-viewport]');
  viewportButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.viewport === session.getViewportPreset()));
  });
  const darkBtn = session.strip.querySelector<HTMLButtonElement>(`.${STRIP_CLASS}__dark-toggle`);
  darkBtn?.setAttribute('aria-pressed', String(session.getDarkModeEmulation()));

  const sub = session.strip.querySelector<HTMLElement>(`.${STRIP_CLASS}__sub`);
  if (sub) {
    sub.hidden = session.armedToolId !== 'draw';
    const activeKind = getDrawTool()?.getShapeKind();
    sub.querySelectorAll<HTMLButtonElement>('[data-shape-kind]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.shapeKind === activeKind));
    });
  }
}

function applyViewportClass(host: HTMLElement, preset: DesignViewportPreset): void {
  for (const p of Object.keys(VIEWPORT_WIDTHS) as DesignViewportPreset[]) {
    host.classList.remove(`${VIEWPORT_CLASS_PREFIX}${p}`);
  }
  host.classList.add(`${VIEWPORT_CLASS_PREFIX}${preset}`);
}

const KEY_TO_TOOL: Record<string, BuiltinDesignToolId> = { v: 'select', p: 'draw', c: 'comment' };

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function onKeyDown(session: InternalSession, paneElement: HTMLElement, ev: KeyboardEvent): void {
  if (!isDesignModeEnabled(session.instanceId)) return;
  if (isTypingTarget(ev.target)) return;
  // Keydown targets the focused element. Clicking the preview leaves focus on <body>
  // (nothing there is focusable), so treat body/root-targeted keys as in-scope; only
  // ignore keys clearly focused into another widget outside the pane.
  const target = ev.target as Node | null;
  const atDocumentRoot =
    !target || target === document.body || target === document.documentElement;
  if (!atDocumentRoot && !paneElement.contains(target)) return;

  if (ev.key === 'Escape') {
    if (session.armedTool) {
      ev.preventDefault();
      session.disarmTool();
    }
    return;
  }

  const toolId = KEY_TO_TOOL[ev.key.toLowerCase()];
  if (toolId && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    ev.preventDefault();
    session.armTool(toolId);
  }
}

/** Enable Design Mode for an instance: mounts overlay + strip, applies persisted prefs. */
export async function enableDesignMode(options: DesignModeMountOptions): Promise<DesignModeSession> {
  const existing = sessions.get(options.instanceId);
  if (existing) return existing;

  // Real Select/Draw/Comment tools (MIN-366/MIN-367); re-registering per enable gives each
  // session a fresh picker/shape/pin closure. Placeholder below fills inspect (future P) only.
  registerDesignTool(createSelectDesignTool());
  registerDesignTool(createDrawDesignTool());
  registerDesignTool(createCommentDesignTool());
  registerBuiltinPlaceholderDesignTools();

  const { instanceId, host } = options;
  const paneElement = options.paneElement ?? host;

  const overlay = createAnnotationOverlay({ host });

  // Build session shell first so closures (buildStrip, buildCaptureLayer) can reference it.
  const session = {
    instanceId,
    host,
    overlay,
    armedTool: null,
    armedToolId: null,
    onExit: options.onExit,
    onClearAll: options.onClearAll,
  } as unknown as InternalSession;

  const armToolInternal = async (id: string, persist: boolean): Promise<void> => {
    const tool = getDesignTool(id);
    if (!tool) return;
    if (session.armedTool && session.armedTool !== tool) session.armedTool.disarm();
    // Guest routing (preview-panel) keys off the armed tool id — set it before sync so
    // cross-origin Select can reveal the native WebContentsView before the picker binds.
    session.armedToolId = id;
    await options.onArmedToolChange?.(id);
    session.armedTool = tool;
    const ctx: DesignToolContext = { instanceId, host, overlay };
    tool.arm(ctx);
    applyCaptureMode(session);
    syncStripState(session);
    if (persist) void saveDesignInstanceMeta(instanceId, { tool: id as DesignInstanceMeta['tool'] });
  };
  session.armTool = (id: string): void => {
    void armToolInternal(id, true);
  };

  session.disarmTool = (): void => {
    if (!session.armedTool) return;
    session.armedTool.disarm();
    session.armedTool = null;
    session.armedToolId = null;
    applyCaptureMode(session);
    syncStripState(session);
    void options.onArmedToolChange?.(null);
    void saveDesignInstanceMeta(instanceId, { tool: null });
  };

  session.getArmedToolId = (): string | null => session.armedToolId;

  let viewportPreset: DesignViewportPreset = DEFAULT_DESIGN_INSTANCE_META.viewportPreset;
  let darkModeEmulation = DEFAULT_DESIGN_INSTANCE_META.darkModeEmulation;

  const setViewportPresetInternal = (preset: DesignViewportPreset, persist: boolean): void => {
    viewportPreset = preset;
    applyViewportClass(host, preset);
    syncStripState(session);
    if (persist) void saveDesignInstanceMeta(instanceId, { viewportPreset: preset });
  };
  session.getViewportPreset = (): DesignViewportPreset => viewportPreset;
  session.setViewportPreset = (preset: DesignViewportPreset): void =>
    setViewportPresetInternal(preset, true);

  const setDarkModeEmulationInternal = (on: boolean, persist: boolean): void => {
    darkModeEmulation = on;
    host.classList.toggle(DARK_EMULATION_CLASS, on);
    // Best-effort real emulation: flip the guest document's color-scheme so pages that
    // honor `color-scheme` / `prefers-color-scheme`-driven variables actually re-render.
    try {
      const transport = createPickerTransport();
      void transport
        .eval(
          `(() => { document.documentElement.style.colorScheme = ${on ? "'dark'" : "''"}; return true; })()`,
        )
        .catch(() => {});
    } catch {
      /* guest unavailable — frame indicator still shows the toggle state */
    }
    syncStripState(session);
    if (persist) void saveDesignInstanceMeta(instanceId, { darkModeEmulation: on });
  };
  session.getDarkModeEmulation = (): boolean => darkModeEmulation;
  session.setDarkModeEmulation = (on: boolean): void => setDarkModeEmulationInternal(on, true);

  session.clearAll = async (): Promise<void> => {
    await clearAllDesignModeMarks({ instanceId, host, overlay });
    options.onClearAll?.();
  };

  session.captureLayer = buildCaptureLayer(host, session);
  session.strip = buildStrip(session);
  host.appendChild(session.strip);
  applyCaptureMode(session);

  const keyHandler = (ev: KeyboardEvent): void => onKeyDown(session, paneElement, ev);
  document.addEventListener('keydown', keyHandler);

  session.destroy = (): void => {
    session.disarmTool();
    document.removeEventListener('keydown', keyHandler);
    session.captureLayer.remove();
    session.strip.remove();
    for (const p of Object.keys(VIEWPORT_WIDTHS) as DesignViewportPreset[]) {
      host.classList.remove(`${VIEWPORT_CLASS_PREFIX}${p}`);
    }
    host.classList.remove(DARK_EMULATION_CLASS);
    overlay.destroy();
    sessions.delete(instanceId);
  };

  sessions.set(instanceId, session);

  // Apply persisted prefs (viewport/dark mode/tool) once loaded, without re-persisting the same
  // values we just read.
  const meta = await loadDesignInstanceMeta(instanceId);
  if (sessions.get(instanceId) !== session) return session; // torn down while awaiting
  setViewportPresetInternal(meta.viewportPreset, false);
  setDarkModeEmulationInternal(meta.darkModeEmulation, false);
  if (meta.tool) await armToolInternal(meta.tool, false);

  void saveDesignInstanceMeta(instanceId, { enabled: true });

  return session;
}

/** Disable Design Mode for an instance: unmounts overlay + strip, leaves the guest untouched. */
export function disableDesignMode(instanceId: string): void {
  const session = sessions.get(instanceId);
  if (!session) return;
  session.destroy();
  void saveDesignInstanceMeta(instanceId, { enabled: false, tool: null });
}

export async function toggleDesignMode(
  options: DesignModeMountOptions,
): Promise<DesignModeSession | null> {
  if (isDesignModeEnabled(options.instanceId)) {
    disableDesignMode(options.instanceId);
    return null;
  }
  return enableDesignMode(options);
}

/** Test helper — tear down every live session between cases. */
export function resetDesignModeForTests(): void {
  for (const session of [...sessions.values()]) session.destroy();
  sessions.clear();
}
