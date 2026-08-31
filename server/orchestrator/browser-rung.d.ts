/**
 * P5-C — Browser rung of the Final Tester ladder (MIN-721).
 *
 * `blocked` is a first-class status here and is never folded into `fail`.
 */

export const BROWSER_UNAVAILABLE_PREFIX: string;
export const BROWSER_BLOCKED_PREFIX: string;

export const BLOCKED_REASONS: readonly [
  'no-observable-criteria',
  'no-dev-server',
  'dev-server-failed',
  'dev-server-unhealthy',
  'browser-unavailable',
  'navigation-blocked',
  'driver-error',
  'aborted',
];

export type BlockedReason = (typeof BLOCKED_REASONS)[number];

export const ASSERTION_KINDS: readonly [
  'text',
  'absent-text',
  'title',
  'http-status',
  'console-clean',
];

export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export const DEFAULT_APP_READY_TIMEOUT_MS: number;
export const DEFAULT_ASSERT_TIMEOUT_MS: number;
export const DEFAULT_SETTLE_MS: number;
export const DEFAULT_RUNG_TIMEOUT_MS: number;

export const DEFAULT_PORT_RELEASE_TIMEOUT_MS: number;

/**
 * Wait until nothing is listening on `port`. Resolves `true` when the port came
 * free, `false` on the deadline.
 */
export function waitForPortFree(
  port: number,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<boolean>;

export interface BrowserAssertion {
  kind: AssertionKind;
  path: string;
  absoluteUrl: string | null;
  expected: string;
  taskId: string | null;
  source: 'accept' | 'checklist';
  criterion: string;
}

export interface SkippedCriterion {
  taskId: string | null;
  source: 'accept' | 'checklist';
  criterion: string;
  reason: string;
}

export interface DerivedBrowserPlan {
  assertions: BrowserAssertion[];
  notObservable: SkippedCriterion[];
}

export interface AssertionResult {
  taskId: string | null;
  source: 'accept' | 'checklist';
  criterion: string;
  kind: string;
  path: string;
  url: string;
  expected: string;
  describe: string;
  outcome: 'pass' | 'fail' | 'blocked';
  detail: string;
}

export interface BrowserRungResult {
  status: 'pass' | 'fail' | 'blocked';
  reason: string | null;
  summary: string;
  runInstructions: string;
  url: string | null;
  appCommand: string | null;
  port: number | null;
  assertions: AssertionResult[];
  notObservable: SkippedCriterion[];
  screenshots: Array<{ id: string; path: string; url: string }>;
}

export type AppStartOk = {
  ok: true;
  url: string;
  command: string | null;
  port: number | null;
  startedHere: boolean;
};

export type AppStartFailed = {
  ok: false;
  reason: 'no-dev-server' | 'dev-server-failed' | 'dev-server-unhealthy';
  detail: string;
  command?: string | null;
  port?: number | null;
  startedHere?: boolean;
};

export interface AppControl {
  start(
    cwd: string,
    opts?: { readyTimeoutMs?: number; portReleaseTimeoutMs?: number; signal?: AbortSignal },
  ): Promise<AppStartOk | AppStartFailed>;
  stop(cwd: string, opts?: { portReleaseTimeoutMs?: number; signal?: AbortSignal }): Promise<void>;
}

/** Compile one observable-outcome sentence, or `null` if a browser cannot see it. */
export function compileAcceptCriterion(text: string): {
  kind: AssertionKind;
  path: string;
  absoluteUrl: string | null;
  expected: string;
} | null;

export function extractPath(
  text: string,
): { path: string; absoluteUrl: string | null } | null;

/** Checklist bullets that are not static ladder commands. */
export function verificationChecklistProse(markdown: string): string[];

/** Every browser assertion the plan's own Accept criteria and checklist imply. */
export function deriveBrowserAssertions(planMarkdown: string): DerivedBrowserPlan;

export function pageBody(output: string): string;
export function statusForUrl(output: string, url: string): string | null;
export function classifyToolError(
  output: string,
): 'browser-unavailable' | 'navigation-blocked' | 'driver-error' | null;
export function assertionUrl(baseUrl: string, assertion: BrowserAssertion): string;
export function describeAssertion(assertion: BrowserAssertion): string;

export function formatBrowserRunInstructions(input: {
  command: string;
  cwd: string;
  url: string;
  steps: string[];
}): string;

/** The verdict with every time-varying field removed — the determinism proof. */
export function canonicalBrowserVerdict(result: BrowserRungResult): string;

export function runBrowserRung(input: {
  cwd: string;
  planMarkdown?: string | null;
  baseUrl?: string | null;
  signal?: AbortSignal;
  callTool?: (name: string, args?: Record<string, unknown>) => Promise<string>;
  app?: AppControl | null;
  closeBrowser?: (cwd: string) => Promise<void>;
  settleMs?: number;
  assertTimeoutMs?: number;
  readyTimeoutMs?: number;
  portReleaseTimeoutMs?: number;
  captureScreenshots?: boolean;
}): Promise<BrowserRungResult>;
