/** Tools that POST /api/tools returns as `Not implemented` (renderer / Electron / DOM). */
export const RENDERER_ONLY_TOOL_IDS: readonly string[];

/**
 * Default server-registry tool ids for unattended agent turns.
 * Contains no renderer-only tool. Callers pass this (or a subset) as an argument.
 */
export const DEFAULT_HEADLESS_TOOL_IDS: readonly string[];

export function isRendererOnlyTool(name: string): boolean;

/** Ids from `ids` that require a renderer. Empty means the set is headless-safe. */
export function rendererOnlyToolsIn(ids: Iterable<string>): string[];
