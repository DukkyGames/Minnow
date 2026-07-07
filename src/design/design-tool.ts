/**
 * DesignTool plug-in contract (MIN-365) — the shape P3/P4 tools (Select, Draw, Comment,
 * Inspect) implement to arm/disarm against a Design Mode session and receive overlay-space
 * pointer events. This module only owns the contract + a process-wide registry; mounting,
 * pointer capture, and dispatch live in design-mode.ts.
 */

import type { AnnotationOverlay } from './overlay';

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
