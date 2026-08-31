/**
 * P5-B — Browser driver tool names and schemas (MIN-720).
 *
 * Pure data; safe to import from the isomorphic runner barrel.
 */

export type PageReadMode = 'a11y' | 'text' | 'dom';
export type ConsoleLevel = 'log' | 'info' | 'warning' | 'error' | 'debug' | 'exception';

export const PAGE_READ_MODES: readonly PageReadMode[];
export const CONSOLE_LEVELS: readonly ConsoleLevel[];

export const BROWSER_DRIVE_NAVIGATE: 'browser_drive_navigate';
export const BROWSER_DRIVE_READ_PAGE: 'browser_drive_read_page';
export const BROWSER_DRIVE_CLICK: 'browser_drive_click';
export const BROWSER_DRIVE_TYPE: 'browser_drive_type';
export const BROWSER_DRIVE_READ_CONSOLE: 'browser_drive_read_console';
export const BROWSER_DRIVE_READ_NETWORK: 'browser_drive_read_network';
export const BROWSER_DRIVE_SCREENSHOT: 'browser_drive_screenshot';
export const BROWSER_DRIVE_RESIZE: 'browser_drive_resize';

/** The whole browser tool surface. A name absent from here is not dispatchable. */
export const BROWSER_DRIVER_TOOL_IDS: readonly string[];

/** Tools whose output is page-controlled text and is fenced as untrusted. */
export const BROWSER_DRIVER_UNTRUSTED_TOOL_IDS: readonly string[];

export interface BrowserDriverToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Full OpenAI function schemas — these tools have no renderer catalog entry. */
export const BROWSER_DRIVER_TOOL_DEFINITIONS: readonly BrowserDriverToolDefinition[];

export const BROWSER_DRIVER_TOOL_DEFINITIONS_BY_NAME: Readonly<
  Record<string, BrowserDriverToolDefinition>
>;
