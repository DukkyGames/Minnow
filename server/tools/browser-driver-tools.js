/**
 * P5-B — The browser driver as a tool surface (MIN-720).
 *
 * These handlers are registered in `SERVER_TOOL_HANDLERS`
 * (`server/runtime/tools-middleware.js`), so the Final Tester reaches the
 * browser through **exactly** the path every other tool takes: P2-D's
 * `executeInProcessTool` → the HTTP-layer guards → `executeServerTool` → the
 * registry. There is no side channel, and there is no board exception — a tool
 * that skipped the guard stack would be a hole in the isolation model.
 *
 * Three properties the issue makes non-negotiable, and where each lives:
 *
 * 1. **Determinism.** Reads are the assertion mechanism, so a read that varies
 *    run-to-run does not merely annoy, it produces flaky abandonments. Every
 *    volatile field is dropped (console timestamps, CDP request ids, response
 *    timings) and every collection with no causal order is sorted
 *    ({@link normalizeNetworkEntries}). The accessibility walk is already
 *    deterministic — its uids come from a per-call counter over document order.
 * 2. **Caps.** A DOM dump is unbounded. Everything returned goes through
 *    `server/tools/output-cap.js`, which appends a `[truncated — …]` footer so
 *    the agent is told, rather than silently reading half a page.
 * 3. **Per-call deadlines.** {@link withCallDeadline} is the only way a handler
 *    returns. A hung navigation fails one tool call with a string the agent can
 *    read; it never rejects upward into the attempt or the run.
 *
 * Screenshots exist and are never an assertion. See P5-A's hazard notes: those
 * round-trips hang. `browser_drive_screenshot` returns a path for a human.
 *
 * Session lifetime: one browser per attempt root (the tool context's effective
 * workspace root), launched lazily on the first navigate. P5-C owns the ladder
 * rung and should call {@link closeBrowserToolSession} when its rung ends; the
 * driver's own `hardTimeoutMs` watchdog and host-exit orphan drain are the
 * backstops if it does not.
 */

import {
  BROWSER_DRIVE_CLICK,
  BROWSER_DRIVE_NAVIGATE,
  BROWSER_DRIVE_READ_CONSOLE,
  BROWSER_DRIVE_READ_NETWORK,
  BROWSER_DRIVE_READ_PAGE,
  BROWSER_DRIVE_RESIZE,
  BROWSER_DRIVE_SCREENSHOT,
  BROWSER_DRIVE_TYPE,
  PAGE_READ_MODES,
} from './browser-driver-tool-defs.js';
import { DEFAULT_MAX_OUTPUT_CHARS, capTextOutput } from './output-cap.js';
import { isNavigationAllowed, originFromUrl, suggestAllowlistPattern } from '../cdp/allowlist.js';
import { loadBrowserConfig } from '../cdp/browser-config.js';
import { launchBrowser } from '../browser-driver/index.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';

/** Default per-tool-call deadline. Reads are fast; this is the wedge detector. */
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** Navigation gets longer — a cold dev server can take a while to answer. */
export const DEFAULT_NAVIGATE_TIMEOUT_MS = 45_000;

/** Ceiling on a caller-supplied `timeout_ms`. Nothing may opt out of a deadline. */
export const MAX_CALL_TIMEOUT_MS = 120_000;

/** Launching a browser is slower than driving one, and is inside navigate's call. */
export const LAUNCH_CALL_TIMEOUT_MS = 90_000;

/** Network ring-buffer size. Older entries are evicted first. */
export const MAX_NETWORK_ENTRIES = 500;

/** Smallest useful `max_chars`. Below this a page read tells you nothing. */
export const MIN_PAGE_READ_CHARS = 500;

/**
 * Stable prefix for "there is no browser here". P5-C matches on this to skip
 * the browser rung rather than failing the run — an unattended machine with no
 * Chromium must degrade, and a Tester cannot be asked to parse prose.
 */
export const BROWSER_UNAVAILABLE_PREFIX = 'Error: browser unavailable';

/** Stable prefix for an allowlist refusal, for the same reason. */
export const BROWSER_BLOCKED_PREFIX = 'Error: navigation blocked by allowlist';

/**
 * @typedef {object} ToolSession
 * @property {import('../browser-driver/index.js').BrowserSession} session
 * @property {Map<string, { url: string, method: string, status: number | null, failed: boolean, errorText: string }>} network
 * @property {boolean} networkEnabled
 * @property {boolean} domEnabled
 */

/** @type {Map<string, ToolSession>} */
const sessions = new Map();

/** @type {Map<string, Promise<ToolSession | { error: string }>>} */
const launching = new Map();

/** @type {import('../browser-driver/index.js').LaunchOptions} */
let launchOptions = {};

/** @type {typeof launchBrowser} */
let launcher = launchBrowser;

/**
 * P5-C seam: options every tool-launched browser gets (headless, viewport,
 * `hardTimeoutMs`). Merged over the driver's defaults, not replacing them.
 * @param {import('../browser-driver/index.js').LaunchOptions} [opts]
 */
export function setBrowserToolLaunchOptions(opts = {}) {
  launchOptions = opts && typeof opts === 'object' ? { ...opts } : {};
}

/**
 * Test seam: swap `launchBrowser`. Pass nothing to restore the real driver.
 * Exists so the timeout, allowlist, and cap behaviour can be tested through
 * the real dispatch path on a machine with no browser.
 * @param {typeof launchBrowser | null} [fn]
 */
export function setBrowserToolLauncher(fn) {
  launcher = typeof fn === 'function' ? fn : launchBrowser;
}

/** Keys (attempt roots) with a live browser. Inspection and tests. */
export function browserToolSessionKeys() {
  return [...sessions.keys()].sort();
}

/**
 * Close the browser for one attempt root. Idempotent, never throws.
 * @param {string} [key] defaults to the current tool context's root
 * @returns {Promise<boolean>} whether there was one to close
 */
export async function closeBrowserToolSession(key) {
  const resolved = key ?? currentSessionKey();
  const entry = sessions.get(resolved);
  if (!entry) return false;
  sessions.delete(resolved);
  try {
    await entry.session.close();
  } catch {
    /* close is best-effort; the driver's watchdog is the backstop */
  }
  return true;
}

/** Close every tool-owned browser. Test teardown and host shutdown. */
export async function closeAllBrowserToolSessions() {
  const keys = [...sessions.keys()];
  await Promise.all(keys.map((key) => closeBrowserToolSession(key)));
}

// ------------------------------------------------------------------ plumbing

/**
 * One browser per attempt root. `getEffectiveWorkspaceRoot()` is the value
 * P2-D's dispatch pushed into the AsyncLocalStorage context, i.e. the attempt's
 * `cwd` — so two boards running at once never share a browser.
 * @returns {string}
 */
function currentSessionKey() {
  try {
    const root = getEffectiveWorkspaceRoot();
    return typeof root === 'string' && root.trim() ? root : 'default';
  } catch {
    return 'default';
  }
}

/**
 * Filename-safe hint for the profile directory, so an orphaned profile can be
 * traced back to the attempt that left it.
 * @param {string} key
 * @returns {string}
 */
function labelFor(key) {
  const tail = String(key).split(/[\\/]/).filter(Boolean).pop() ?? 'attempt';
  return tail.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'attempt';
}

const TIMED_OUT = Symbol('browser-tool-call-timed-out');

/**
 * Run `fn` under an independent deadline. Nothing below this function is
 * allowed to reject upward: a hung navigation must cost one tool call, not the
 * attempt and certainly not the run.
 *
 * The work promise is defused with a `catch` before the race, because a
 * rejection that lands after the deadline has already been reported would
 * otherwise be an unhandled rejection — which on this host is a crash, i.e.
 * exactly the failure the deadline exists to prevent.
 *
 * Phases get their own deadlines rather than sharing one budget: launching a
 * browser and loading a page are different waits, and folding them together
 * would make a fast page inherit the launch allowance.
 *
 * @template T
 * @param {string} toolName
 * @param {number} timeoutMs
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ ok: true, value: T } | { ok: false, text: string }>}
 */
async function guardCall(toolName, timeoutMs, fn) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  const work = (async () => {
    try {
      return { ok: /** @type {const} */ (true), value: await fn() };
    } catch (err) {
      return { ok: /** @type {const} */ (false), text: `Error: ${errorMessage(err)}` };
    }
  })();
  work.catch(() => {});

  const outcome = await Promise.race([work, deadline]);
  clearTimeout(timer);

  if (outcome === TIMED_OUT) {
    return {
      ok: false,
      text:
        `Error: ${toolName} timed out after ${timeoutMs}ms. ` +
        'The browser session is left as-is; this call failed, the attempt did not. ' +
        'Read the page or the console to see how far it got, or retry with a larger timeout_ms.',
    };
  }
  return /** @type {{ ok: true, value: T } | { ok: false, text: string }} */ (outcome);
}

/**
 * `guardCall` for the common case: the body already returns the agent-facing
 * string.
 * @param {string} toolName
 * @param {number} timeoutMs
 * @param {() => Promise<string>} fn
 * @returns {Promise<string>}
 */
async function withCallDeadline(toolName, timeoutMs, fn) {
  const outcome = await guardCall(toolName, timeoutMs, fn);
  return outcome.ok ? outcome.value : outcome.text;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param {unknown} raw
 * @param {number} fallback
 * @returns {number}
 */
function callTimeout(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_CALL_TIMEOUT_MS, Math.floor(n));
}

/**
 * @param {unknown} raw
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Everything an agent reads goes through the shared cap, so one page read
 * cannot blow the context window.
 *
 * `maxLineChars` differs by kind on purpose. Console and network output is
 * line-shaped and a single 400-char line is plenty. A DOM dump is frequently
 * *one* line — a minified document — and the default line cap would reduce a
 * whole page to 400 characters, which is a worse failure than truncating the
 * tail. There the total budget does the work alone.
 *
 * @param {string} text
 * @param {{ maxChars?: number, lineShaped?: boolean, hint?: string }} [opts]
 * @returns {string}
 */
function capped(text, opts = {}) {
  const maxOutputChars = clampInt(
    opts.maxChars,
    DEFAULT_MAX_OUTPUT_CHARS,
    MIN_PAGE_READ_CHARS,
    DEFAULT_MAX_OUTPUT_CHARS,
  );
  const result = capTextOutput(text, {
    maxOutputChars,
    maxLineChars: opts.lineShaped ? undefined : maxOutputChars,
    footerHint: opts.hint ?? 'narrow the read (mode="text", a smaller max_chars) or scope the page',
  });
  return result.text;
}

// ------------------------------------------------------------------- session

/**
 * Attach the network recorder. The driver deliberately does not buffer network
 * traffic (P5-A is transport and lifecycle), so the tool layer owns it, keyed
 * by CDP request id — an id that is never emitted, because it varies run to run.
 *
 * @param {ToolSession} entry
 */
async function enableNetworkRecording(entry) {
  const client = entry.session.client;
  /** @param {string} id */
  const touch = (id) => {
    let row = entry.network.get(id);
    if (!row) {
      row = { url: '', method: '', status: null, failed: false, errorText: '' };
      entry.network.set(id, row);
      while (entry.network.size > MAX_NETWORK_ENTRIES) {
        const oldest = entry.network.keys().next();
        if (oldest.done) break;
        entry.network.delete(oldest.value);
      }
    }
    return row;
  };

  client.on('Network.requestWillBeSent', (params) => {
    const request = /** @type {any} */ (params).request ?? {};
    const row = touch(String(/** @type {any} */ (params).requestId ?? ''));
    row.url = String(request.url ?? '');
    row.method = String(request.method ?? 'GET');
  });
  client.on('Network.responseReceived', (params) => {
    const response = /** @type {any} */ (params).response ?? {};
    const row = touch(String(/** @type {any} */ (params).requestId ?? ''));
    if (!row.url) row.url = String(response.url ?? '');
    const status = Number(response.status);
    row.status = Number.isFinite(status) ? status : null;
  });
  client.on('Network.loadingFailed', (params) => {
    const row = touch(String(/** @type {any} */ (params).requestId ?? ''));
    row.failed = true;
    row.errorText = String(/** @type {any} */ (params).errorText ?? 'failed');
  });

  try {
    await client.send('Network.enable', {});
    entry.networkEnabled = true;
  } catch {
    // Optional. `browser_drive_read_network` says so rather than lying with [].
    entry.networkEnabled = false;
  }
}

/**
 * Launch (once) the browser for this attempt root.
 *
 * Concurrent tool calls share one in-flight launch: two browsers for one
 * attempt would double the profile teardown and halve the meaning of
 * `browser_drive_read_page`.
 *
 * @param {string} key
 * @returns {Promise<ToolSession | { error: string }>}
 */
async function ensureSession(key) {
  const existing = sessions.get(key);
  if (existing) {
    if (existing.session.alive) return existing;
    // The browser died (crash, external kill, hard timeout). Drop it and
    // relaunch rather than handing back a session that rejects everything.
    sessions.delete(key);
  }

  const inFlight = launching.get(key);
  if (inFlight) return inFlight;

  const attempt = (async () => {
    const launched = await launcher({ label: labelFor(key), ...launchOptions });
    if (!launched.ok) {
      return {
        error:
          `${BROWSER_UNAVAILABLE_PREFIX} (${launched.reason}): ${launched.detail}. ` +
          'Report the browser check as skipped, not failed, and continue with the other rungs.',
      };
    }
    /** @type {ToolSession} */
    const entry = {
      session: launched.session,
      network: new Map(),
      networkEnabled: false,
      domEnabled: false,
    };
    await enableNetworkRecording(entry);
    sessions.set(key, entry);
    return entry;
  })().finally(() => {
    launching.delete(key);
  });

  launching.set(key, attempt);
  return attempt;
}

/**
 * Fetch the live session for a tool call that requires one. Tools other than
 * navigate never launch a browser — a `read_page` before any `navigate` has an
 * answer ("nothing is open"), not a browser to start.
 *
 * @returns {{ entry: ToolSession } | { error: string }}
 */
function requireSession() {
  const entry = sessions.get(currentSessionKey());
  if (!entry) {
    return { error: `no browser is open. Call ${BROWSER_DRIVE_NAVIGATE} first.` };
  }
  if (!entry.session.alive) {
    const status = entry.session.status();
    return {
      error:
        `the browser session ended (${status.endedReason ?? 'ended'}` +
        `${status.endedDetail ? `: ${status.endedDetail}` : ''}). ` +
        `Call ${BROWSER_DRIVE_NAVIGATE} to start a new one.`,
    };
  }
  return { entry };
}

/**
 * Resolve a snapshot uid to a CDP remote object.
 *
 * uids are only meaningful against the snapshot that produced them, which is
 * why every interaction invalidates `lastSnapshot`: acting on a uid from a
 * page that has since changed is the classic source of a driver that clicks
 * the wrong thing and reports success.
 *
 * @param {ToolSession} entry
 * @param {number} uid
 * @param {number} timeoutMs
 * @returns {Promise<{ objectId: string, backendNodeId: number, node: import('../browser-driver/index.js').SnapshotNode }>}
 */
async function resolveNodeByUid(entry, uid, timeoutMs) {
  const snapshot = entry.session.lastSnapshot;
  if (!snapshot) {
    throw new Error(
      `no current page snapshot. Call ${BROWSER_DRIVE_READ_PAGE} with mode="a11y" first, ` +
        'then use a [uid] from its output.',
    );
  }
  const node = snapshot.byUid.get(uid);
  if (!node) {
    throw new Error(
      `uid ${uid} is not in the current snapshot. Call ${BROWSER_DRIVE_READ_PAGE} again ` +
        'and use a [uid] from the fresh output.',
    );
  }
  if (!node.backendNodeId) {
    throw new Error(`uid ${uid} (${node.role}) has no DOM node behind it and cannot be acted on.`);
  }

  const client = entry.session.client;
  if (!entry.domEnabled) {
    await client.send('DOM.enable', {}, { timeoutMs });
    entry.domEnabled = true;
  }
  const resolved = await client.send(
    'DOM.resolveNode',
    { backendNodeId: node.backendNodeId },
    { timeoutMs },
  );
  const objectId = /** @type {any} */ (resolved).object?.objectId;
  if (!objectId) {
    throw new Error(`uid ${uid} (${node.role}) could not be resolved in the live page.`);
  }
  return { objectId, backendNodeId: node.backendNodeId, node };
}

/**
 * @param {ToolSession} entry
 * @param {string} objectId
 * @param {string} functionDeclaration
 * @param {number} timeoutMs
 * @returns {Promise<unknown>}
 */
async function callOn(entry, objectId, functionDeclaration, timeoutMs) {
  const result = await entry.session.client.send(
    'Runtime.callFunctionOn',
    { objectId, functionDeclaration, returnByValue: true, awaitPromise: false },
    { timeoutMs },
  );
  const exception = /** @type {any} */ (result).exceptionDetails;
  if (exception) {
    const text = exception.exception?.description ?? exception.text ?? 'call failed';
    throw new Error(String(text).split('\n')[0]);
  }
  return /** @type {any} */ (result).result?.value;
}

/**
 * @param {ToolSession} entry
 * @param {string} objectId
 */
async function releaseObject(entry, objectId) {
  try {
    await entry.session.client.send('Runtime.releaseObject', { objectId });
  } catch {
    /* the object dies with the page; leaking one is not worth a failed call */
  }
}

/** A uid-addressed action changed the page, so the snapshot no longer describes it. */
const STALE_SNAPSHOT_NOTE =
  'The page snapshot is now stale — call browser_drive_read_page again before the next uid.';

/**
 * @param {ToolSession} entry
 */
function invalidateSnapshot(entry) {
  entry.session.lastSnapshot = null;
}

// --------------------------------------------------------------- normalizers

/**
 * Console entries as deterministic lines.
 *
 * The driver stamps every entry with `Date.now()`. That timestamp is exactly
 * the kind of field that makes two reads of one static page differ, so it is
 * dropped here rather than formatted.
 *
 * @param {Array<{ level: string, text: string, at?: number }>} entries
 * @param {{ level?: string, limit?: number }} [opts]
 * @returns {string[]}
 */
export function normalizeConsoleEntries(entries, opts = {}) {
  const level =
    typeof opts.level === 'string' && opts.level.trim() ? opts.level.trim().toLowerCase() : null;
  let rows = (Array.isArray(entries) ? entries : []).filter(
    (entry) => !level || String(entry?.level ?? '').toLowerCase() === level,
  );
  if (typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0) {
    rows = rows.slice(-Math.floor(opts.limit));
  }
  return rows.map(
    (entry) => `[${String(entry?.level ?? 'log')}] ${String(entry?.text ?? '').replace(/\r?\n/g, ' ')}`,
  );
}

/**
 * Network entries as deterministic lines.
 *
 * Requests complete in whatever order the network gives them, so insertion
 * order is not reproducible even for a static page. Sorting on
 * (url, method, status) is: it is a total order over the fields we emit, and
 * the fields we emit are the ones that carry meaning. Request ids, timings,
 * and sizes are dropped for the same reason console timestamps are.
 *
 * @param {Iterable<{ url: string, method: string, status: number | null, failed: boolean, errorText: string }>} entries
 * @param {{ failedOnly?: boolean, limit?: number }} [opts]
 * @returns {string[]}
 */
export function normalizeNetworkEntries(entries, opts = {}) {
  const rows = [...(entries ?? [])].filter((row) => row && String(row.url ?? '').length > 0);
  const kept = opts.failedOnly
    ? rows.filter((row) => row.failed || (typeof row.status === 'number' && row.status >= 400))
    : rows;

  kept.sort((a, b) => {
    if (a.url !== b.url) return a.url < b.url ? -1 : 1;
    if (a.method !== b.method) return a.method < b.method ? -1 : 1;
    return (a.status ?? -1) - (b.status ?? -1);
  });

  const limited =
    typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
      ? kept.slice(0, Math.floor(opts.limit))
      : kept;

  return limited.map((row) => {
    const status = row.failed
      ? `FAILED(${row.errorText || 'error'})`
      : typeof row.status === 'number'
        ? String(row.status)
        : 'pending';
    return `${row.method || 'GET'} ${status} ${row.url}`;
  });
}

// ------------------------------------------------------------------ handlers

/**
 * `browser_drive_navigate`
 *
 * The allowlist is checked **before** the browser is launched, so a blocked
 * URL costs nothing and a Tester that guesses an origin does not spawn a
 * Chromium to be told no. `BrowserSession.navigate` checks it again against
 * the patterns snapshotted at launch; both call `server/cdp/allowlist.js`,
 * the same module `/api/browser/allowlist/check` serves the renderer from.
 *
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>}
 */
export async function toolBrowserDriveNavigate(args = {}) {
  const timeoutMs = callTimeout(args.timeout_ms, DEFAULT_NAVIGATE_TIMEOUT_MS);

  // Phase 1: validate, check the allowlist, and (only then) have a browser.
  const prepared = await guardCall(BROWSER_DRIVE_NAVIGATE, LAUNCH_CALL_TIMEOUT_MS, async () => {
    const url = String(args.url ?? '').trim();
    if (!url) return 'Error: url is required';

    let origin;
    try {
      origin = originFromUrl(url);
    } catch {
      return `Error: invalid url: ${url}`;
    }

    const config = await loadBrowserConfig();
    if (!isNavigationAllowed(url, config.allowedOriginPatterns)) {
      return (
        `${BROWSER_BLOCKED_PREFIX}: ${origin} ` +
        `(suggested pattern: ${suggestAllowlistPattern(url)}). ` +
        'Add the origin under Settings → Browser (browser.allowedOriginPatterns). ' +
        'Board agents get no interactive approval — do not retry this origin.'
      );
    }

    const ready = await ensureSession(currentSessionKey());
    if ('error' in ready) return ready.error;
    return { entry: ready, url };
  });
  if (!prepared.ok) return prepared.text;
  if (typeof prepared.value === 'string') return prepared.value;
  const { entry, url } = prepared.value;

  // Phase 2: the load itself, on its own clock.
  return withCallDeadline(BROWSER_DRIVE_NAVIGATE, timeoutMs, async () => {
    const result = await entry.session.navigate(url, { timeoutMs });
    invalidateSnapshot(entry);
    const lines = [`outcome: ${result.outcome}`, `url: ${result.url}`, `title: ${result.title}`];
    if (result.outcome === 'timeout') {
      lines.push(
        result.killed
          ? 'note: the browser stopped answering and was killed. Navigate again to restart it.'
          : `note: the load event did not fire within ${timeoutMs}ms. ` +
            'The DOM may still be readable — read the page.',
      );
    }
    return lines.join('\n');
  });
}

/**
 * `browser_drive_read_page`
 *
 * The assertion mechanism. `a11y` is the default because it is the most stable
 * of the three: role/name pairs survive styling churn that would break a DOM
 * diff, and its uids are what click/type address.
 *
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>}
 */
export async function toolBrowserDriveReadPage(args = {}) {
  const timeoutMs = callTimeout(args.timeout_ms, DEFAULT_CALL_TIMEOUT_MS);
  return withCallDeadline(BROWSER_DRIVE_READ_PAGE, timeoutMs, async () => {
    const rawMode = String(args.mode ?? 'a11y').trim().toLowerCase();
    const mode = /** @type {'a11y' | 'text' | 'dom'} */ (rawMode || 'a11y');
    if (!PAGE_READ_MODES.includes(/** @type {any} */ (mode))) {
      return `Error: mode must be one of ${PAGE_READ_MODES.join(', ')}`;
    }

    const found = requireSession();
    if ('error' in found) return `Error: ${found.error}`;
    const { entry } = found;

    const maxChars = args.max_chars;
    const header = `url: ${entry.session.currentUrl ?? '(none)'}\nmode: ${mode}\n---`;

    if (mode === 'a11y') {
      const snapshot = await entry.session.snapshot({ timeoutMs });
      return capped(`${header}\n${snapshot.text}`, {
        maxChars,
        lineShaped: true,
        hint: 'read mode="text" for a smaller view, or narrow with max_chars',
      });
    }
    if (mode === 'text') {
      const text = await entry.session.text({ timeoutMs, maxChars: DEFAULT_MAX_OUTPUT_CHARS });
      return capped(`${header}\n${text}`, { maxChars, lineShaped: true });
    }
    const html = await entry.session.html({ timeoutMs, maxChars: DEFAULT_MAX_OUTPUT_CHARS });
    return capped(`${header}\n${html}`, {
      maxChars,
      hint: 'read mode="a11y" or mode="text" instead of the full DOM',
    });
  });
}

/**
 * `browser_drive_click`
 *
 * `.click()` on the resolved node rather than a synthesized mouse event at
 * coordinates: coordinates need layout, scrolling, and overlay handling to be
 * right, and every one of those is a way for a verification click to land
 * somewhere else and still report success.
 *
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>}
 */
export async function toolBrowserDriveClick(args = {}) {
  const timeoutMs = callTimeout(args.timeout_ms, DEFAULT_CALL_TIMEOUT_MS);
  return withCallDeadline(BROWSER_DRIVE_CLICK, timeoutMs, async () => {
    const uid = Number(args.uid);
    if (!Number.isInteger(uid) || uid <= 0) return 'Error: uid must be a positive integer';

    const found = requireSession();
    if ('error' in found) return `Error: ${found.error}`;
    const { entry } = found;

    const { objectId, node } = await resolveNodeByUid(entry, uid, timeoutMs);
    try {
      await callOn(
        entry,
        objectId,
        'function () {\n' +
          '  if (typeof this.scrollIntoView === "function") this.scrollIntoView({ block: "center" });\n' +
          '  if (typeof this.click !== "function") throw new Error("element is not clickable");\n' +
          '  this.click();\n' +
          '  return true;\n' +
          '}',
        timeoutMs,
      );
    } finally {
      await releaseObject(entry, objectId);
    }
    invalidateSnapshot(entry);
    return `clicked [${uid}] ${node.role}${node.name ? ` "${node.name}"` : ''}\n${STALE_SNAPSHOT_NOTE}`;
  });
}

/**
 * `browser_drive_type`
 *
 * `Input.insertText` after a real focus, not an assignment to `.value`.
 * Assigning `.value` on a framework-controlled input updates the DOM and not
 * the component state, which is the single most common way a browser test
 * passes against a field the app never saw.
 *
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>}
 */
export async function toolBrowserDriveType(args = {}) {
  const timeoutMs = callTimeout(args.timeout_ms, DEFAULT_CALL_TIMEOUT_MS);
  return withCallDeadline(BROWSER_DRIVE_TYPE, timeoutMs, async () => {
    const uid = Number(args.uid);
    if (!Number.isInteger(uid) || uid <= 0) return 'Error: uid must be a positive integer';
    if (typeof args.text !== 'string') return 'Error: text is required';
    const text = args.text;
    const clear = args.clear !== false;
    const submit = args.submit === true;

    const found = requireSession();
    if ('error' in found) return `Error: ${found.error}`;
    const { entry } = found;

    const { objectId, node } = await resolveNodeByUid(entry, uid, timeoutMs);
    try {
      // Focus, and select the existing content when replacing: `insertText`
      // overwrites the selection, so "clear" needs no separate delete.
      await callOn(
        entry,
        objectId,
        'function () {\n' +
          '  if (typeof this.scrollIntoView === "function") this.scrollIntoView({ block: "center" });\n' +
          '  if (typeof this.focus !== "function") throw new Error("element cannot take focus");\n' +
          '  this.focus();\n' +
          `  if (${clear ? 'true' : 'false'} && typeof this.select === "function") this.select();\n` +
          '  return true;\n' +
          '}',
        timeoutMs,
      );
      await entry.session.client.send('Input.insertText', { text }, { timeoutMs });
      if (submit) {
        for (const type of ['keyDown', 'keyUp']) {
          await entry.session.client.send(
            'Input.dispatchKeyEvent',
            { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
            { timeoutMs },
          );
        }
      }
    } finally {
      await releaseObject(entry, objectId);
    }
    invalidateSnapshot(entry);
    const what = `${node.role}${node.name ? ` "${node.name}"` : ''}`;
    return (
      `typed ${text.length} chars into [${uid}] ${what}` +
      `${clear ? ' (replaced existing content)' : ''}${submit ? ' and pressed Enter' : ''}\n` +
      STALE_SNAPSHOT_NOTE
    );
  });
}

/**
 * `browser_drive_read_console`
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>}
 */
export async function toolBrowserDriveReadConsole(args = {}) {
  const timeoutMs = callTimeout(args.timeout_ms, DEFAULT_CALL_TIMEOUT_MS);
  return withCallDeadline(BROWSER_DRIVE_READ_CONSOLE, timeoutMs, async () => {
    const found = requireSession();
    if ('error' in found) return `Error: ${found.error}`;

    const lines = normalizeConsoleEntries(found.entry.session.consoleMessages(), {
      level: typeof args.level === 'string' ? args.level : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    });
    if (lines.length === 0) return 'console: (no entries)';
    return capped(`console: ${lines.length} entries\n---\n${lines.join('\n')}`, {
      lineShaped: true,
      hint: 'filter with level, or lower limit',
    });
  });
}

/**
 * `browser_drive_read_network`
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>}
 */
export async function toolBrowserDriveReadNetwork(args = {}) {
  const timeoutMs = callTimeout(args.timeout_ms, DEFAULT_CALL_TIMEOUT_MS);
  return withCallDeadline(BROWSER_DRIVE_READ_NETWORK, timeoutMs, async () => {
    const found = requireSession();
    if ('error' in found) return `Error: ${found.error}`;
    const { entry } = found;
    if (!entry.networkEnabled) {
      return 'Error: network recording is not available on this browser session.';
    }

    const lines = normalizeNetworkEntries(entry.network.values(), {
      failedOnly: args.failed_only === true,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    });
    if (lines.length === 0) {
      return args.failed_only === true
        ? 'network: (no failed requests)'
        : 'network: (no requests recorded)';
    }
    return capped(
      `network: ${lines.length} requests (sorted by url, method, status)\n---\n${lines.join('\n')}`,
      { lineShaped: true, hint: 'use failed_only=true, or lower limit' },
    );
  });
}

/**
 * `browser_drive_screenshot`
 *
 * Evidence for a human report. Never an assertion — see the module header and
 * P5-A's hazard notes. A failure here returns a line, not an error, because a
 * missing screenshot must not turn a passing verification into a failure.
 *
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>}
 */
export async function toolBrowserDriveScreenshot(args = {}) {
  const timeoutMs = callTimeout(args.timeout_ms, DEFAULT_CALL_TIMEOUT_MS);
  return withCallDeadline(BROWSER_DRIVE_SCREENSHOT, timeoutMs, async () => {
    const found = requireSession();
    if ('error' in found) return `Error: ${found.error}`;

    const result = await found.entry.session.screenshot({ timeoutMs });
    if (!result.ok) {
      return `screenshot: not captured (${result.error}). Evidence only — assert with ${BROWSER_DRIVE_READ_PAGE}.`;
    }
    return [
      `screenshot: ${result.id}`,
      `path: ${result.filePath}`,
      `bytes: ${result.sizeBytes}`,
      `Evidence for the report only — assert with ${BROWSER_DRIVE_READ_PAGE}.`,
    ].join('\n');
  });
}

/**
 * `browser_drive_resize`
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>}
 */
export async function toolBrowserDriveResize(args = {}) {
  const timeoutMs = callTimeout(args.timeout_ms, DEFAULT_CALL_TIMEOUT_MS);
  return withCallDeadline(BROWSER_DRIVE_RESIZE, timeoutMs, async () => {
    const width = Number(args.width);
    const height = Number(args.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return 'Error: width and height are required';
    }
    const w = clampInt(width, 1280, 200, 4000);
    const h = clampInt(height, 800, 200, 4000);

    const found = requireSession();
    if ('error' in found) return `Error: ${found.error}`;
    const { entry } = found;

    await entry.session.client.send(
      'Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile: false },
      { timeoutMs },
    );
    invalidateSnapshot(entry);
    return `viewport: ${w}x${h}\n${STALE_SNAPSHOT_NOTE}`;
  });
}

/**
 * The registry slice. Spread into `SERVER_TOOL_HANDLERS` so P2-D dispatches
 * these exactly like `grep` or `git_status` — same guards, same output path.
 */
export const BROWSER_DRIVER_TOOL_HANDLERS = Object.freeze({
  [BROWSER_DRIVE_NAVIGATE]: toolBrowserDriveNavigate,
  [BROWSER_DRIVE_READ_PAGE]: toolBrowserDriveReadPage,
  [BROWSER_DRIVE_CLICK]: toolBrowserDriveClick,
  [BROWSER_DRIVE_TYPE]: toolBrowserDriveType,
  [BROWSER_DRIVE_READ_CONSOLE]: toolBrowserDriveReadConsole,
  [BROWSER_DRIVE_READ_NETWORK]: toolBrowserDriveReadNetwork,
  [BROWSER_DRIVE_SCREENSHOT]: toolBrowserDriveScreenshot,
  [BROWSER_DRIVE_RESIZE]: toolBrowserDriveResize,
});
