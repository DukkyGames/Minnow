/** Tools that POST /api/tools returns as `Not implemented` (renderer / Electron / DOM). */
export const RENDERER_ONLY_TOOL_IDS: readonly string[];

/**
 * Default server-registry tool ids for unattended agent turns.
 * Contains no renderer-only tool. Callers pass this (or a subset) as an argument.
 */
export const DEFAULT_HEADLESS_TOOL_IDS: readonly string[];

/** P5-B server-side browser driver tool ids. Disjoint from the renderer `browser_*` set. */
export const BROWSER_TOOL_IDS: readonly string[];

/** The headless default plus the browser. Final Tester only. */
export const FINAL_TESTER_TOOL_IDS: readonly string[];

/** The single gate: only role `final` gets the browser tools. */
export function headlessToolIdsForRole(role: string): readonly string[];

export function isBrowserDriverTool(name: string): boolean;

/** Browser ids present in `ids`. Empty is the Builder/Tester invariant. */
export function browserToolsIn(ids: Iterable<string>): string[];

export function isRendererOnlyTool(name: string): boolean;

/** Ids from `ids` that require a renderer. Empty means the set is headless-safe. */
export function rendererOnlyToolsIn(ids: Iterable<string>): string[];
