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
  BUILTIN_DESIGN_TOOL_IDS,
  type BuiltinDesignToolId,
  type DesignTool,
  type DesignToolContext,
  type DesignToolPointerEvent,
} from './design-tool';
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
  /** Keyboard-shortcut scope; defaults to `host` when omitted. */
  paneElement?: HTMLElement;
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
  destroy(): void;
}

interface InternalSession extends DesignModeSession {
  captureLayer: HTMLElement;
  armedTool: DesignTool | null;
  armedToolId: string | null;
}

const sessions = new Map<string, InternalSession>();

export function isDesignModeEnabled(instanceId: string): boolean {
  return sessions.has(instanceId);
}

export function getDesignModeSession(instanceId: string): DesignModeSession | undefined {
  return sessions.get(instanceId);
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

/** Pass-through unless a tool is armed — this is the whole "leave the guest untouched" contract. */
function applyCaptureMode(session: InternalSession): void {
  session.captureLayer.style.pointerEvents = session.armedTool ? 'auto' : 'none';
  session.captureLayer.style.cursor = session.armedTool ? 'crosshair' : '';
}

function buildCaptureLayer(host: HTMLElement, session: InternalSession): HTMLElement {
  const layer = document.createElement('div');
  layer.className = CAPTURE_CLASS;
  layer.style.cssText = 'position:absolute;inset:0;z-index:3;pointer-events:none;';

  const onPointerDown = (ev: PointerEvent): void => {
    session.armedTool?.onPointerDown?.(toToolEvent(host, ev));
  };
  const onPointerMove = (ev: PointerEvent): void => {
    session.armedTool?.onPointerMove?.(toToolEvent(host, ev));
  };
  const onPointerUp = (ev: PointerEvent): void => {
    session.armedTool?.onPointerUp?.(toToolEvent(host, ev));
  };

  layer.addEventListener('pointerdown', onPointerDown);
  layer.addEventListener('pointermove', onPointerMove);
  layer.addEventListener('pointerup', onPointerUp);
  layer.addEventListener('pointercancel', onPointerUp);

  host.appendChild(layer);
  return layer;
}

function toolButtonLabel(id: BuiltinDesignToolId): string {
  switch (id) {
    case 'select':
      return 'Select (V)';
    case 'draw':
      return 'Draw (P)';
    case 'comment':
      return 'Comment (C)';
    case 'inspect':
      return 'Inspect';
    default:
      return id;
  }
}

function buildStrip(session: InternalSession): HTMLElement {
  const strip = document.createElement('div');
  strip.className = STRIP_CLASS;
  strip.setAttribute('role', 'toolbar');
  strip.setAttribute('aria-label', 'Design Mode tools');
  strip.style.cssText = 'position:absolute;z-index:4;pointer-events:auto;';

  const tools = document.createElement('div');
  tools.className = `${STRIP_CLASS}__tools`;
  for (const id of BUILTIN_DESIGN_TOOL_IDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${STRIP_CLASS}__btn`;
    btn.dataset.tool = id;
    btn.setAttribute('aria-pressed', 'false');
    btn.title = toolButtonLabel(id);
    btn.textContent = toolButtonLabel(id).replace(/\s*\(.*\)$/, '');
    btn.addEventListener('click', () => {
      if (session.armedToolId === id) session.disarmTool();
      else session.armTool(id);
    });
    tools.appendChild(btn);
  }
  strip.appendChild(tools);

  const viewportGroup = document.createElement('div');
  viewportGroup.className = `${STRIP_CLASS}__viewports`;
  (['mobile', 'tablet', 'desktop'] as DesignViewportPreset[]).forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${STRIP_CLASS}__btn`;
    btn.dataset.viewport = preset;
    btn.setAttribute('aria-pressed', String(preset === session.getViewportPreset()));
    btn.title =
      preset === 'desktop' ? 'Desktop (full width)' : `${preset[0]!.toUpperCase()}${preset.slice(1)} (${VIEWPORT_WIDTHS[preset]}px)`;
    btn.textContent = preset[0]!.toUpperCase() + preset.slice(1);
    btn.addEventListener('click', () => session.setViewportPreset(preset));
    viewportGroup.appendChild(btn);
  });
  strip.appendChild(viewportGroup);

  const darkToggle = document.createElement('button');
  darkToggle.type = 'button';
  darkToggle.className = `${STRIP_CLASS}__btn ${STRIP_CLASS}__dark-toggle`;
  darkToggle.title = 'Emulate dark mode';
  darkToggle.textContent = 'Dark';
  darkToggle.setAttribute('aria-pressed', String(session.getDarkModeEmulation()));
  darkToggle.addEventListener('click', () => session.setDarkModeEmulation(!session.getDarkModeEmulation()));
  strip.appendChild(darkToggle);

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
  if (!paneElement.contains(ev.target as Node)) return;

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
  } as unknown as InternalSession;

  const armToolInternal = (id: string, persist: boolean): void => {
    const tool = getDesignTool(id);
    if (!tool) return;
    if (session.armedTool && session.armedTool !== tool) session.armedTool.disarm();
    session.armedTool = tool;
    session.armedToolId = id;
    const ctx: DesignToolContext = { instanceId, host, overlay };
    tool.arm(ctx);
    applyCaptureMode(session);
    syncStripState(session);
    if (persist) void saveDesignInstanceMeta(instanceId, { tool: id as DesignInstanceMeta['tool'] });
  };
  session.armTool = (id: string): void => armToolInternal(id, true);

  session.disarmTool = (): void => {
    if (!session.armedTool) return;
    session.armedTool.disarm();
    session.armedTool = null;
    session.armedToolId = null;
    applyCaptureMode(session);
    syncStripState(session);
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
    syncStripState(session);
    if (persist) void saveDesignInstanceMeta(instanceId, { darkModeEmulation: on });
  };
  session.getDarkModeEmulation = (): boolean => darkModeEmulation;
  session.setDarkModeEmulation = (on: boolean): void => setDarkModeEmulationInternal(on, true);

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
  if (meta.tool) armToolInternal(meta.tool, false);

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
