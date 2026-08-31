/**
 * P5-B — Browser driver tool handlers (MIN-720).
 *
 * Registered in `SERVER_TOOL_HANDLERS`, so P2-D's in-process dispatch reaches
 * them exactly as it reaches every other server tool. Every handler resolves to
 * a string and never rejects: a hung call fails itself, not the attempt.
 */

import type { LaunchOptions, LaunchResult } from '../browser-driver/index';

export const DEFAULT_CALL_TIMEOUT_MS: number;
export const DEFAULT_NAVIGATE_TIMEOUT_MS: number;
export const MAX_CALL_TIMEOUT_MS: number;
export const LAUNCH_CALL_TIMEOUT_MS: number;
export const MAX_NETWORK_ENTRIES: number;
export const MIN_PAGE_READ_CHARS: number;

/** Stable prefix P5-C matches to skip the browser rung instead of failing it. */
export const BROWSER_UNAVAILABLE_PREFIX: string;

/** Stable prefix for an allowlist refusal. */
export const BROWSER_BLOCKED_PREFIX: string;

/** Launch options applied to every tool-launched browser (P5-C seam). */
export function setBrowserToolLaunchOptions(opts?: LaunchOptions): void;

/** Test seam: swap `launchBrowser`. Omit the argument to restore the driver. */
export function setBrowserToolLauncher(
  fn?: ((opts?: LaunchOptions) => Promise<LaunchResult>) | null,
): void;

/** Attempt roots that currently own a browser, sorted. */
export function browserToolSessionKeys(): string[];

/** Close one attempt's browser. Idempotent, never throws. */
export function closeBrowserToolSession(key?: string): Promise<boolean>;

/** Close every tool-owned browser. */
export function closeAllBrowserToolSessions(): Promise<void>;

export interface NormalizeConsoleOptions {
  level?: string;
  limit?: number;
}

/** Console entries as deterministic lines — timestamps dropped, order kept. */
export function normalizeConsoleEntries(
  entries: Array<{ level: string; text: string; at?: number }>,
  opts?: NormalizeConsoleOptions,
): string[];

export interface NetworkRow {
  url: string;
  method: string;
  status: number | null;
  failed: boolean;
  errorText: string;
}

export interface NormalizeNetworkOptions {
  failedOnly?: boolean;
  limit?: number;
}

/**
 * Network entries as deterministic lines — sorted by (url, method, status),
 * carrying no request ids, timings, or sizes.
 */
export function normalizeNetworkEntries(
  entries: Iterable<NetworkRow>,
  opts?: NormalizeNetworkOptions,
): string[];

export type BrowserToolHandler = (args?: Record<string, unknown>) => Promise<string>;

export const toolBrowserDriveNavigate: BrowserToolHandler;
export const toolBrowserDriveReadPage: BrowserToolHandler;
export const toolBrowserDriveClick: BrowserToolHandler;
export const toolBrowserDriveType: BrowserToolHandler;
export const toolBrowserDriveReadConsole: BrowserToolHandler;
export const toolBrowserDriveReadNetwork: BrowserToolHandler;
export const toolBrowserDriveScreenshot: BrowserToolHandler;
export const toolBrowserDriveResize: BrowserToolHandler;

/** The registry slice, spread into `SERVER_TOOL_HANDLERS`. */
export const BROWSER_DRIVER_TOOL_HANDLERS: Readonly<Record<string, BrowserToolHandler>>;
