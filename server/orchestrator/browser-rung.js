/**
 * P5-C — The browser rung of the Final Tester ladder (MIN-721).
 *
 * The static ladder (P3-F) proves the code compiles. It cannot prove the app
 * works. This module is the rung that closes that gap: start the app, drive a
 * real browser at it, and check the *plan's own* observable outcomes.
 *
 * ## Three rules this module exists to keep
 *
 * 1. **The static rungs gate this one.** `runFinalLadder` never calls in here
 *    until typecheck/lint/unit/build are green. Launching Chromium against a
 *    build that does not compile produces confusing failures and burns minutes
 *    per run. Enforcement lives at the call site, and is asserted by test.
 *
 * 2. **Assertions are derived, never invented.** The Planner already writes,
 *    per task, "one observable outcome that proves this task is done". That
 *    sentence *is* the browser assertion. {@link deriveBrowserAssertions}
 *    compiles it mechanically — no model, no paraphrase. A criterion this
 *    compiler cannot read is reported as not-observable and asserts nothing;
 *    it is never guessed at, because a guessed assertion that passes is worse
 *    than no assertion at all.
 *
 * 3. **`blocked` is not `fail`.** A missing browser, a driver crash, a dev
 *    server that will not start, or a plan with no browser-observable criterion
 *    all mean *the verification could not run* — a different fact from *the app
 *    is broken*. They are journalled separately ({@link BrowserRungResult}
 *    `status`, and `evidence.browser` in `final.test.ended`). Only an assertion
 *    that actually executed and did not hold is `fail`. Collapsing the two
 *    turns a flaky driver into a fictional regression, which is the single
 *    fastest way to make unattended operation untrustworthy.
 *
 * ## Determinism
 *
 * Ten consecutive runs against an unchanged app must give ten identical
 * verdicts, so nothing here may depend on wall-clock timing or arrival order:
 *
 * - Assertions are **sorted** into a canonical order before execution, so the
 *   navigation sequence is a function of the plan text alone.
 * - Positive assertions **poll to a deadline** rather than reading once. A
 *   working app then passes on the first read and a broken one fails after the
 *   full wait — the verdict is the same either way; only the duration moves.
 * - Negative assertions (absent text, clean console) are evaluated after a
 *   fixed settle window, because polling cannot help something that starts out
 *   satisfied.
 * - Reads come from P5-B's tools, which already drop console timestamps, CDP
 *   request ids, and response timings, and sort network rows.
 * - Screenshots are report evidence and never an assertion; their ids are
 *   time-based and are excluded from {@link canonicalBrowserVerdict}.
 *
 * ## What this module does not do
 *
 * It does not spawn a browser or a server by hand. Browsers come from P5-B's
 * `browser_drive_*` tools through the ordinary in-process tool dispatch (so the
 * guard stack applies), and the app comes from `server/dev-server/`, the
 * repo's existing dev-server management. Both are injectable so the unit tests
 * run on bare node with neither a browser nor a server.
 */

import net from 'node:net';
import path from 'node:path';

import { isParseErrors, parsePlan } from './core/parse-plan.js';

/**
 * P5-B exports these same two strings. They are duplicated rather than
 * imported so that `final-test.js`'s import closure stays free of the tool
 * registry, the browser driver, and the config store — the ladder must be
 * loadable (and unit-testable) on a machine with no browser at all.
 * `test/orchestrator/browser-rung.test.mjs` pins the duplicates to the
 * originals, the same arrangement `tool-set.js` uses for the renderer catalog.
 */
export const BROWSER_UNAVAILABLE_PREFIX = 'Error: browser unavailable';

/** @see BROWSER_UNAVAILABLE_PREFIX */
export const BROWSER_BLOCKED_PREFIX = 'Error: navigation blocked by allowlist';

/** Reasons the rung could not run. Every one of these is `blocked`, not `fail`. */
export const BLOCKED_REASONS = /** @type {const} */ ([
  'no-observable-criteria',
  'no-dev-server',
  'dev-server-failed',
  'dev-server-unhealthy',
  'browser-unavailable',
  'navigation-blocked',
  'driver-error',
  'aborted',
]);

/** Assertion kinds this compiler can produce. */
export const ASSERTION_KINDS = /** @type {const} */ ([
  'text',
  'absent-text',
  'title',
  'http-status',
  'console-clean',
]);

/** How long to wait for the dev server to answer on its pinned port. */
export const DEFAULT_APP_READY_TIMEOUT_MS = 90_000;

/** How long a positive assertion may poll before it is a failure. */
export const DEFAULT_ASSERT_TIMEOUT_MS = 10_000;

/** Fixed settle window after a navigation, before anything is asserted. */
export const DEFAULT_SETTLE_MS = 750;

/** Poll interval while waiting for a positive assertion. */
const POLL_INTERVAL_MS = 200;

/** Whole-rung ceiling. The engine must never wait on this rung indefinitely. */
export const DEFAULT_RUNG_TIMEOUT_MS = 300_000;

/**
 * How long to wait for the pinned port to be released after a stop.
 *
 * `stopDevServerById` kills the process tree and returns; it does not wait for
 * the socket to close. On a pinned port that races our own next start, and the
 * race is not theoretical — it cost one wrong verdict in ten consecutive runs
 * before this wait existed. See {@link waitForPortFree}.
 */
export const DEFAULT_PORT_RELEASE_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------- derivation

const NEXT_HEADING = /^## /m;
const CHECKLIST_HEADING = /^## Verification Checklist\b/m;

/** Quoted spans, in preference order: smart quotes, double, single. */
const QUOTED_PATTERNS = [
  /“([^”]{1,200})”/,
  /"([^"]{1,200})"/,
  /'([^']{1,200})'/,
];

/** A bare or backticked absolute path: `/`, `/settings`, `/api/v1/foo`. */
const PATH_RE = /(?:^|[\s`("[])(\/(?:[A-Za-z0-9\-._~/]*[A-Za-z0-9\-._~/])?)/;

/** A fully-qualified http(s) URL anywhere in the sentence. */
const URL_RE = /\bhttps?:\/\/[^\s`"'<>)\]]+/;

/** "returns 200", "responds with 404", "gives a 500". */
const STATUS_RE = /\b(?:returns?|responds?\s+with|answers?\s+with|gives?)\s+(?:an?\s+|HTTP\s+)?([1-5]\d{2})\b/i;

/** "no console errors", "the console is clean", "without console errors". */
const CONSOLE_CLEAN_RE = /\bconsole\b/i;
const CLEAN_RE = /\b(?:no|zero|free\s+of|without|clean|clear)\b/i;
const ERRORS_RE = /\berrors?\b/i;

/** "the title is …", "document title reads …". */
const TITLE_RE = /\btitle\b/i;

/**
 * Words that say a criterion is about something on a screen.
 *
 * A quoted span alone is *not* evidence of a browser-observable outcome. Most
 * plans are not about UI, and their Accept criteria quote identifiers:
 * `the barrel exports "journalSize"`, `tokenCost separates "total_tokens"`.
 * Compiling those into "the page at / shows this string" produces assertions
 * that are not merely useless but actively wrong — they fail against a working
 * app and turn a good run into a fictional regression. Measured on a realistic
 * 18-task non-UI plan: eight false assertions, every one of which would fail.
 *
 * So a text or title assertion needs an anchor: either an explicit route in the
 * sentence, or one of these nouns. Deliberately absent from the list:
 *
 * - `browser`, because `entries ending in "browser"` is a plain string check.
 * - `section` and `report`, which are as often documents as they are screens.
 * - `render`, which loses to identifiers like `renderRunReport` on a word
 *   boundary and would otherwise let any function named render-something in.
 */
const UI_SURFACE_RE =
  /\b(?:page|screen|route|dialog|modal|banner|header|footer|sidebar|button|link|form|toast|tooltip|menu|tab|ui|on[\s-]screen|visible|displays?|displayed|renders|rendered)\b/i;

/** "document title", "page title" — a title claim that is about a browser. */
const DOCUMENT_TITLE_RE = /\b(?:document|page|tab)\s+title\b|\btitle\s+of\s+the\s+page\b/i;

/** Negation immediately governing the quoted span. */
const NEGATION_RE =
  /\b(?:no\s+longer|not|never|without|doesn't|does\s+not|isn't|is\s+not|aren't|are\s+not|hidden|removed|gone|absent|disappears?|disappeared)\b/i;

/** Commands, not observable outcomes. Reuses the static ladder's vocabulary. */
const LADDER_COMMAND_RE = /\b(?:tsc|typecheck|lint|npm(?:\.cmd)?\s+(?:test|run)|yarn|pnpm|vitest|jest|eslint|prettier|cargo|go\s+test)\b/i;

/**
 * @param {string} text
 * @returns {{ value: string, index: number } | null}
 */
function firstQuoted(text) {
  /** @type {{ value: string, index: number } | null} */
  let best = null;
  for (const pattern of QUOTED_PATTERNS) {
    const match = pattern.exec(text);
    if (!match || typeof match[1] !== 'string' || !match[1].trim()) continue;
    if (best === null || match.index < best.index) {
      best = { value: match[1].trim(), index: match.index };
    }
  }
  return best;
}

/**
 * The path a criterion is about. A full URL wins over a bare path (a criterion
 * that names an origin means that origin); otherwise the first `/…` token.
 * `null` means "wherever the app's entry point is", which the caller resolves
 * to `/`.
 *
 * @param {string} text
 * @returns {{ path: string, absoluteUrl: string | null } | null}
 */
export function extractPath(text) {
  const raw = String(text ?? '');
  const url = URL_RE.exec(raw)?.[0];
  if (url) {
    try {
      const parsed = new URL(url);
      return { path: `${parsed.pathname}${parsed.search}`, absoluteUrl: url };
    } catch {
      /* fall through to the bare-path form */
    }
  }
  const bare = PATH_RE.exec(raw)?.[1];
  // `/**` and `/*` are touches globs, not routes.
  if (bare && !bare.includes('*')) return { path: bare, absoluteUrl: null };
  return null;
}

/**
 * Compile one observable-outcome sentence into a browser assertion.
 *
 * The vocabulary is deliberately small and closed. Every kind here is
 * checkable with P5-B's read tools alone — no `evaluate`, no CSS selectors, no
 * synthesized events — because an assertion mechanism the tool surface cannot
 * express deterministically is an assertion that will flake.
 *
 * Returns `null` when the sentence is not browser-observable. That is a normal
 * outcome, not an error: "the module exports a pure function" is a perfectly
 * good Accept criterion that a browser cannot see.
 *
 * @param {string} text
 * @returns {{
 *   kind: 'text' | 'absent-text' | 'title' | 'http-status' | 'console-clean',
 *   path: string,
 *   absoluteUrl: string | null,
 *   expected: string,
 * } | null}
 */
export function compileAcceptCriterion(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const located = extractPath(raw);
  const at = located?.path ?? '/';
  const absoluteUrl = located?.absoluteUrl ?? null;

  // 1. Clean console. Checked first: "no console errors after saving" also
  //    contains a quoted-looking clause often enough to be worth ordering.
  if (CONSOLE_CLEAN_RE.test(raw) && ERRORS_RE.test(raw) && CLEAN_RE.test(raw)) {
    return { kind: 'console-clean', path: at, absoluteUrl, expected: 'no console errors' };
  }

  // 2. HTTP status. Needs a route to be meaningful — a bare "returns 200"
  //    with no path is not an observable outcome, it is half of one.
  const status = STATUS_RE.exec(raw)?.[1];
  if (status && located) {
    return { kind: 'http-status', path: at, absoluteUrl, expected: status };
  }

  const quoted = firstQuoted(raw);
  if (!quoted) return null;

  // 3. Document title. A bare "title" is not enough — plenty of non-UI criteria
  //    are about a title field. It needs a route, or "document title".
  if (TITLE_RE.test(raw.slice(0, quoted.index))) {
    if (!located && !DOCUMENT_TITLE_RE.test(raw)) return null;
    return { kind: 'title', path: at, absoluteUrl, expected: quoted.value };
  }

  // 4. Visible text, positive or negative — but only when the sentence is
  //    actually about a screen. See UI_SURFACE_RE: a quoted identifier in a
  //    criterion about a module export is not a page assertion, and compiling
  //    it as one fails against a perfectly good app.
  if (!located && !UI_SURFACE_RE.test(raw)) return null;

  //    The negation window is the clause leading up to the quote, not the whole
  //    sentence: "shows 'Saved'" in a task titled "no longer crashes" must not
  //    be read as an absence check.
  const lead = raw.slice(0, quoted.index);
  const clause = lead.slice(Math.max(0, lead.length - 60));
  const kind = NEGATION_RE.test(clause) ? 'absent-text' : 'text';
  return { kind, path: at, absoluteUrl, expected: quoted.value };
}

/**
 * The `## Verification Checklist` bullets that are *not* static ladder
 * commands. A checklist line like "open `/settings` and the header reads
 * “Dashboard”" is an observable outcome the Planner wrote for a human;
 * it is exactly as good a browser assertion as an Accept criterion.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
export function verificationChecklistProse(markdown) {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n');
  const start = text.search(CHECKLIST_HEADING);
  if (start < 0) return [];
  const afterHeading = text.slice(start).split('\n').slice(1).join('\n');
  const endRel = afterHeading.search(NEXT_HEADING);
  const body = endRel >= 0 ? afterHeading.slice(0, endRel) : afterHeading;

  /** @type {string[]} */
  const out = [];
  for (const line of body.split('\n')) {
    const bullet = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.*)$/.exec(line);
    if (!bullet) continue;
    const value = bullet[1].trim();
    if (!value) continue;
    // A backticked command is a static rung; it is already covered and must
    // not be re-run in a browser.
    const backticked = /`([^`]+)`/.exec(value)?.[1] ?? '';
    if (backticked && LADDER_COMMAND_RE.test(backticked)) continue;
    out.push(value);
  }
  return out;
}

/**
 * Canonical order. Grouped by path so one navigation serves every assertion at
 * that path, and totally ordered within a path so the read sequence is a
 * function of the plan text and nothing else.
 *
 * @param {BrowserAssertion} a
 * @param {BrowserAssertion} b
 * @returns {number}
 */
function compareAssertions(a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  // Positive assertions first: they poll, and polling gives a negative
  // assertion on the same page a longer, not shorter, settle window.
  const aNeg = a.kind === 'absent-text' || a.kind === 'console-clean' ? 1 : 0;
  const bNeg = b.kind === 'absent-text' || b.kind === 'console-clean' ? 1 : 0;
  if (aNeg !== bNeg) return aNeg - bNeg;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.expected !== b.expected) return a.expected < b.expected ? -1 : 1;
  return String(a.taskId ?? '') < String(b.taskId ?? '') ? -1 : 1;
}

/**
 * @typedef {object} BrowserAssertion
 * @property {'text' | 'absent-text' | 'title' | 'http-status' | 'console-clean'} kind
 * @property {string} path
 * @property {string | null} absoluteUrl
 * @property {string} expected
 * @property {string | null} taskId
 * @property {'accept' | 'checklist'} source
 * @property {string} criterion
 *
 * @typedef {object} SkippedCriterion
 * @property {string | null} taskId
 * @property {'accept' | 'checklist'} source
 * @property {string} criterion
 * @property {string} reason
 *
 * @typedef {object} DerivedBrowserPlan
 * @property {BrowserAssertion[]} assertions
 * @property {SkippedCriterion[]} notObservable
 */

/**
 * Derive the browser rung's assertions from a plan document.
 *
 * Order of preference is the issue's: each task's `Accept` criterion first
 * (the Planner is required to make it an observable outcome), then the
 * `## Verification Checklist` prose. Duplicates collapse — two tasks that both
 * assert the same text at the same path are one navigation and one read.
 *
 * @param {string} planMarkdown
 * @returns {DerivedBrowserPlan}
 */
export function deriveBrowserAssertions(planMarkdown) {
  const markdown = String(planMarkdown ?? '');
  /** @type {BrowserAssertion[]} */
  const assertions = [];
  /** @type {SkippedCriterion[]} */
  const notObservable = [];
  /** @type {Set<string>} */
  const seen = new Set();

  /**
   * @param {string} criterion
   * @param {string | null} taskId
   * @param {'accept' | 'checklist'} source
   */
  const consider = (criterion, taskId, source) => {
    const compiled = compileAcceptCriterion(criterion);
    if (!compiled) {
      notObservable.push({ taskId, source, criterion, reason: 'not-browser-observable' });
      return;
    }
    const key = `${compiled.kind} ${compiled.absoluteUrl ?? compiled.path} ${compiled.expected}`;
    if (seen.has(key)) return;
    seen.add(key);
    assertions.push({ ...compiled, taskId, source, criterion });
  };

  const parsed = parsePlan(markdown);
  if (!isParseErrors(parsed)) {
    for (const task of parsed.tasks) {
      const accept = String(task.accept ?? '').trim();
      if (!accept) {
        notObservable.push({
          taskId: task.id,
          source: 'accept',
          criterion: '',
          reason: 'no-accept-criterion',
        });
        continue;
      }
      consider(accept, task.id, 'accept');
    }
  }

  for (const line of verificationChecklistProse(markdown)) {
    consider(line, null, 'checklist');
  }

  assertions.sort(compareAssertions);
  return { assertions, notObservable };
}

// ------------------------------------------------------------------ evidence

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeForMatch(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Strip the `url:` / `mode:` header P5-B's `browser_drive_read_page` prints, so
 * a needle cannot match the URL bar instead of the page.
 *
 * @param {string} output
 * @returns {string}
 */
export function pageBody(output) {
  const text = String(output ?? '');
  const marker = text.indexOf('\n---\n');
  return marker < 0 ? text : text.slice(marker + 5);
}

/**
 * @param {string} output
 * @returns {string | null}
 */
function titleFromNavigate(output) {
  return /^title:\s*(.*)$/m.exec(String(output ?? ''))?.[1]?.trim() ?? null;
}

/**
 * Status for one URL out of `browser_drive_read_network`'s deterministic
 * `METHOD STATUS URL` rows.
 *
 * @param {string} output
 * @param {string} url
 * @returns {string | null}
 */
export function statusForUrl(output, url) {
  const target = String(url ?? '');
  const alternates = new Set([target, target.replace(/\/$/, ''), `${target.replace(/\/$/, '')}/`]);
  for (const line of String(output ?? '').split('\n')) {
    const row = /^(\w+)\s+(\S+)\s+(\S+)$/.exec(line.trim());
    if (!row) continue;
    if (!alternates.has(row[3])) continue;
    return row[2];
  }
  return null;
}

/**
 * Was this tool output a driver problem rather than an answer?
 *
 * @param {string} output
 * @returns {'browser-unavailable' | 'navigation-blocked' | 'driver-error' | null}
 */
export function classifyToolError(output) {
  const text = String(output ?? '');
  if (text.startsWith(BROWSER_UNAVAILABLE_PREFIX)) return 'browser-unavailable';
  if (text.startsWith(BROWSER_BLOCKED_PREFIX)) return 'navigation-blocked';
  if (/^Error:/.test(text)) return 'driver-error';
  return null;
}

// ----------------------------------------------------------------- execution

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  return new Promise((resolve) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    if (timer.unref) timer.unref();
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * Is anything listening on this port right now?
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const settle = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

/**
 * Wait until nothing is listening on `port`, or the deadline passes.
 *
 * This closes the one race the rung can create for itself. Stopping the app
 * kills the process tree without waiting for its socket, so a start on the same
 * pinned port can arrive while the previous server is still accepting. The new
 * child then fails to bind and dies, the health probe is answered by the *old*
 * server and reports healthy, and the browser gets a connection error partway
 * through the run. The symptom is a `fail` on a positive text assertion while
 * the absence assertion on the same page passes — an app that is gone satisfies
 * every "does not contain" check. Measured: one such verdict in ten runs.
 *
 * Returns whether the port actually came free; the caller decides what to do
 * about a port that never does.
 *
 * @param {number} port
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<boolean>}
 */
export async function waitForPortFree(port, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_PORT_RELEASE_TIMEOUT_MS);
  for (;;) {
    if (!(await portInUse(port))) return true;
    if (Date.now() >= deadline || opts.signal?.aborted) return false;
    await delay(POLL_INTERVAL_MS, opts.signal);
  }
}

/**
 * @param {string} baseUrl
 * @param {BrowserAssertion} assertion
 * @returns {string}
 */
export function assertionUrl(baseUrl, assertion) {
  if (assertion.absoluteUrl) return assertion.absoluteUrl;
  try {
    return new URL(assertion.path || '/', baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

/**
 * A one-line, human-readable statement of what an assertion expects.
 *
 * @param {BrowserAssertion} assertion
 * @returns {string}
 */
export function describeAssertion(assertion) {
  switch (assertion.kind) {
    case 'text':
      return `page text contains ${JSON.stringify(assertion.expected)}`;
    case 'absent-text':
      return `page text does not contain ${JSON.stringify(assertion.expected)}`;
    case 'title':
      return `document title contains ${JSON.stringify(assertion.expected)}`;
    case 'http-status':
      return `the request for ${assertion.path} has status ${assertion.expected}`;
    case 'console-clean':
      return 'the console has no error entries';
    default:
      return `unknown assertion ${String(assertion.kind)}`;
  }
}

/**
 * The default tool caller: P5-B's `browser_drive_*` through the ordinary
 * in-process dispatch, with the Final Tester's allowed set. Imported lazily so
 * `final-test.js` stays loadable without the tool registry.
 *
 * @param {string} cwd
 * @returns {Promise<(name: string, args?: Record<string, unknown>) => Promise<string>>}
 */
async function defaultBrowserTools(cwd) {
  const [{ executeInProcessTool }, { headlessToolIdsForRole }] = await Promise.all([
    import('../runner/tool-dispatch.js'),
    import('../runner/tool-set.js'),
  ]);
  const allowedToolNames = [...headlessToolIdsForRole('final')];
  return async (name, args = {}) => {
    const out = await executeInProcessTool(name, args, { cwd, allowedToolNames });
    return String(out?.content ?? '');
  };
}

/**
 * The default app control: `server/dev-server/`, the repo's existing dev-server
 * management. Not a hand-rolled `spawn` — that path already knows how to read
 * `startup.md`, resolve the effective command, pin the port, probe health, and
 * (crucially for an unattended run) kill the process tree on Windows.
 *
 * @returns {Promise<AppControl>}
 */
async function defaultAppControl() {
  const manager = await import('../dev-server/manager.js');
  return {
    async start(cwd, opts = {}) {
      const before = await manager.getDevServerStatusById(cwd);
      if (!before.startupExists && !before.def) {
        return {
          ok: false,
          reason: 'no-dev-server',
          detail:
            'no startup.md and no registered dev server for this workspace, so there is no ' +
            'defined way to start the app',
        };
      }
      const alreadyRunning = before.status === 'running';

      // If the manager says nothing of ours is running, the pinned port must
      // be free before we start — otherwise we would either fail to bind and
      // then verify a stranger's server, or race a predecessor that is still
      // shutting down. See `waitForPortFree`.
      if (!alreadyRunning && typeof before.port === 'number') {
        const free = await waitForPortFree(before.port, {
          timeoutMs: opts.portReleaseTimeoutMs,
          signal: opts.signal,
        });
        if (!free) {
          return {
            ok: false,
            reason: 'dev-server-unhealthy',
            detail:
              `port ${before.port} is already in use by something this rung did not start, ` +
              'so there is no way to know which app would be verified',
            command: before.command ?? null,
            port: before.port,
            startedHere: false,
          };
        }
      }

      const started = await manager.startDevServerById(cwd, undefined, {
        worktreeRoot: cwd,
        strictPort: true,
      });
      if (!started.ok) {
        return { ok: false, reason: 'dev-server-failed', detail: started.error ?? 'start failed' };
      }

      // Pin, then verify by inspection. The port comes from the resolved guide
      // and is never searched for: a Vite that auto-incremented past a busy
      // port is a *different* app than the one under test, and finding it
      // would be worse than reporting that the pinned port is not serving.
      const deadline = Date.now() + (opts.readyTimeoutMs ?? DEFAULT_APP_READY_TIMEOUT_MS);
      /** @type {Awaited<ReturnType<typeof manager.getDevServerStatusById>> | null} */
      let status = null;
      for (;;) {
        status = await manager.getDevServerStatusById(cwd);
        if (status.healthOk === true || (status.healthUrl == null && status.portInUse)) break;
        if (status.status === 'error') break;
        if (Date.now() >= deadline || opts.signal?.aborted) break;
        await delay(400, opts.signal);
      }
      const port = status?.port ?? null;
      const healthy = status?.healthOk === true || (status?.healthUrl == null && status?.portInUse);
      const command = status?.command ?? null;
      if (!healthy || port == null) {
        return {
          ok: false,
          reason: 'dev-server-unhealthy',
          detail:
            `the dev server did not answer on its pinned port ${port ?? '(unknown)'} ` +
            `(status ${status?.status ?? 'unknown'}${status?.error ? `: ${status.error}` : ''})`,
          command,
          port,
          startedHere: !alreadyRunning,
        };
      }
      const origin = status?.healthUrl
        ? new URL(status.healthUrl).origin
        : `http://127.0.0.1:${port}`;
      return {
        ok: true,
        url: `${origin}/`,
        command,
        port,
        startedHere: !alreadyRunning,
      };
    },
    async stop(cwd, opts = {}) {
      // Read the port before the row is cleared — after the stop there is
      // nothing left to tell us which port to wait on.
      const before = await manager.getDevServerStatusById(cwd).catch(() => null);
      await manager.stopDevServerById(cwd);
      if (typeof before?.port === 'number') {
        await waitForPortFree(before.port, {
          timeoutMs: opts.portReleaseTimeoutMs,
          signal: opts.signal,
        });
      }
    },
  };
}

/**
 * Close the browser P5-B opened for this attempt root. Lazily imported for the
 * same reason the tools are.
 *
 * @param {string} cwd
 * @returns {Promise<void>}
 */
async function defaultCloseBrowser(cwd) {
  const { closeBrowserToolSession } = await import('../tools/browser-driver-tools.js');
  await closeBrowserToolSession(path.resolve(cwd));
}

/**
 * @typedef {object} AppStartOk
 * @property {true} ok
 * @property {string} url
 * @property {string | null} command
 * @property {number | null} port
 * @property {boolean} startedHere
 *
 * @typedef {object} AppStartFailed
 * @property {false} ok
 * @property {'no-dev-server' | 'dev-server-failed' | 'dev-server-unhealthy'} reason
 * @property {string} detail
 * @property {string | null} [command]
 * @property {number | null} [port]
 * @property {boolean} [startedHere]
 *
 * @typedef {object} AppControl
 * @property {(cwd: string, opts?: { readyTimeoutMs?: number, portReleaseTimeoutMs?: number, signal?: AbortSignal }) => Promise<AppStartOk | AppStartFailed>} start
 * @property {(cwd: string, opts?: { portReleaseTimeoutMs?: number, signal?: AbortSignal }) => Promise<void>} stop
 *
 * @typedef {object} AssertionResult
 * @property {string | null} taskId
 * @property {'accept' | 'checklist'} source
 * @property {string} criterion
 * @property {string} kind
 * @property {string} path
 * @property {string} url
 * @property {string} expected
 * @property {string} describe
 * @property {'pass' | 'fail' | 'blocked'} outcome
 * @property {string} detail
 *
 * @typedef {object} BrowserRungResult
 * @property {'pass' | 'fail' | 'blocked'} status
 * @property {string | null} reason
 * @property {string} summary
 * @property {string} runInstructions
 * @property {string | null} url
 * @property {string | null} appCommand
 * @property {number | null} port
 * @property {AssertionResult[]} assertions
 * @property {SkippedCriterion[]} notObservable
 * @property {Array<{ id: string, path: string, url: string }>} screenshots
 */

/**
 * `runInstructions` for the browser rung: the command that starts the app, the
 * cwd it starts in, the URL to open, and the steps. A human who follows these
 * four lines reproduces the verdict by hand — which is the only definition of
 * "reproducible" worth having.
 *
 * `command:` and `cwd:` keep their P3-F meaning and position so
 * `parseRunInstructions` still reads them.
 *
 * @param {{ command: string, cwd: string, url: string, steps: string[] }} input
 * @returns {string}
 */
export function formatBrowserRunInstructions(input) {
  const lines = [
    `command: ${String(input?.command ?? '').trim()}`,
    `cwd: ${String(input?.cwd ?? '').trim()}`,
    `url: ${String(input?.url ?? '').trim()}`,
    'steps:',
  ];
  const steps = Array.isArray(input?.steps) ? input.steps : [];
  steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  return lines.join('\n');
}

/**
 * A verdict with every time-varying field removed, for the ten-identical-runs
 * proof. Screenshot ids are timestamps and durations are wall-clock; neither is
 * part of the *result*, so neither belongs in the comparison.
 *
 * @param {BrowserRungResult} result
 * @returns {string}
 */
export function canonicalBrowserVerdict(result) {
  return JSON.stringify({
    status: result.status,
    reason: result.reason,
    summary: result.summary,
    runInstructions: result.runInstructions,
    url: result.url,
    appCommand: result.appCommand,
    assertions: (result.assertions ?? []).map((a) => ({
      taskId: a.taskId,
      source: a.source,
      kind: a.kind,
      path: a.path,
      url: a.url,
      expected: a.expected,
      outcome: a.outcome,
      detail: a.detail,
    })),
    notObservable: result.notObservable ?? [],
    screenshotCount: (result.screenshots ?? []).length,
  });
}

/**
 * @param {BrowserAssertion} assertion
 * @param {string} url
 * @param {'pass' | 'fail' | 'blocked'} outcome
 * @param {string} detail
 * @returns {AssertionResult}
 */
function assertionResult(assertion, url, outcome, detail) {
  return {
    taskId: assertion.taskId,
    source: assertion.source,
    criterion: assertion.criterion,
    kind: assertion.kind,
    path: assertion.path,
    url,
    expected: assertion.expected,
    describe: describeAssertion(assertion),
    outcome,
    detail,
  };
}

/**
 * Run the browser rung.
 *
 * The caller is responsible for having run the static rungs first — see the
 * module header, rule 1. This function assumes a compiling build.
 *
 * It resolves, always. A throw from a tool, the dev server, or the driver
 * becomes `blocked`, never an unhandled rejection into the engine.
 *
 * @param {{
 *   cwd: string,
 *   planMarkdown?: string | null,
 *   baseUrl?: string | null,
 *   signal?: AbortSignal,
 *   callTool?: (name: string, args?: Record<string, unknown>) => Promise<string>,
 *   app?: AppControl | null,
 *   closeBrowser?: (cwd: string) => Promise<void>,
 *   settleMs?: number,
 *   assertTimeoutMs?: number,
 *   readyTimeoutMs?: number,
 *   portReleaseTimeoutMs?: number,
 *   captureScreenshots?: boolean,
 * }} input
 * @returns {Promise<BrowserRungResult>}
 */
export async function runBrowserRung(input) {
  const cwd = path.resolve(input.cwd);
  const derived = deriveBrowserAssertions(input.planMarkdown ?? '');
  const settleMs = input.settleMs ?? DEFAULT_SETTLE_MS;
  const assertTimeoutMs = input.assertTimeoutMs ?? DEFAULT_ASSERT_TIMEOUT_MS;
  const captureScreenshots = input.captureScreenshots !== false;

  /**
   * @param {string} reason
   * @param {string} summary
   * @param {string} command
   * @param {string} url
   * @param {string[]} steps
   * @returns {BrowserRungResult}
   */
  const blocked = (reason, summary, command, url, steps) => ({
    status: /** @type {const} */ ('blocked'),
    reason,
    summary,
    runInstructions: formatBrowserRunInstructions({ command, cwd, url, steps }),
    url: url || null,
    appCommand: command || null,
    port: null,
    assertions: [],
    notObservable: derived.notObservable,
    screenshots: [],
  });

  // Rule 2's other half: no criterion the compiler can read means there is
  // nothing to verify, which is `blocked` — not a silent pass, and certainly
  // not a fail.
  if (derived.assertions.length === 0) {
    return blocked(
      'no-observable-criteria',
      'Browser rung blocked: the plan has no browser-observable Accept criterion or checklist item. ' +
        `${derived.notObservable.length} criteria were read and none named a page, a route, a title, ` +
        'a quoted on-screen string, or the console.',
      '(no app started)',
      '(none)',
      [
        'The Planner writes one observable outcome per task under **Accept:**.',
        'Make at least one of them browser-observable — quote the on-screen text, name the route, ' +
          'or state the expected HTTP status — and this rung will verify it.',
      ],
    );
  }

  if (input.signal?.aborted) {
    return blocked('aborted', 'Browser rung aborted before it started.', '(aborted)', '(none)', []);
  }

  const app = input.app === null ? null : (input.app ?? (await defaultAppControl()));
  const closeBrowser = input.closeBrowser ?? defaultCloseBrowser;

  /** @type {AppStartOk | AppStartFailed} */
  let started;
  if (input.baseUrl && !app) {
    started = { ok: true, url: input.baseUrl, command: '(app already running)', port: null, startedHere: false };
  } else if (!app) {
    return blocked(
      'no-dev-server',
      'Browser rung blocked: no way to start the app was provided.',
      '(no app started)',
      input.baseUrl ?? '(none)',
      [],
    );
  } else {
    try {
      started = await app.start(cwd, {
        readyTimeoutMs: input.readyTimeoutMs,
        portReleaseTimeoutMs: input.portReleaseTimeoutMs,
        signal: input.signal,
      });
    } catch (err) {
      started = {
        ok: false,
        reason: 'dev-server-failed',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (!started.ok) {
    const failed = /** @type {AppStartFailed} */ (started);
    const result = blocked(
      failed.reason,
      `Browser rung blocked: ${failed.detail}. The static ladder was green; the app could not be verified.`,
      failed.command ?? '(app did not start)',
      input.baseUrl ?? '(none)',
      [
        'Start the app yourself in that cwd.',
        'Confirm it answers on the port the dev-server guide pins.',
        'Then re-run the ladder.',
      ],
    );
    if (failed.startedHere) {
      try {
        await app?.stop(cwd, { portReleaseTimeoutMs: input.portReleaseTimeoutMs });
      } catch {
        /* teardown is best-effort; the reason is already recorded */
      }
    }
    return result;
  }

  const baseUrl = input.baseUrl || started.url;
  const appCommand = started.command ?? '(dev server already running)';

  /** @type {AssertionResult[]} */
  const results = [];
  /** @type {Array<{ id: string, path: string, url: string }>} */
  const screenshots = [];
  /** @type {string | null} */
  let blockedReason = null;
  /** @type {string} */
  let blockedDetail = '';

  const callTool = input.callTool ?? (await defaultBrowserTools(cwd));

  try {
    // Group by resolved URL: one navigation serves every assertion on a page.
    /** @type {Map<string, BrowserAssertion[]>} */
    const byUrl = new Map();
    for (const assertion of derived.assertions) {
      const url = assertionUrl(baseUrl, assertion);
      const list = byUrl.get(url);
      if (list) list.push(assertion);
      else byUrl.set(url, [assertion]);
    }

    for (const [url, group] of byUrl) {
      if (blockedReason === 'browser-unavailable') break;
      if (input.signal?.aborted) {
        blockedReason = 'aborted';
        blockedDetail = 'the run was stopped';
        break;
      }

      const navOut = await callTool('browser_drive_navigate', { url });
      const navError = classifyToolError(navOut);
      if (navError) {
        // A missing browser is fatal to the rung and stops it immediately;
        // there is no point navigating nine more times to be told the same.
        blockedReason = navError;
        blockedDetail = navOut.split('\n')[0];
        for (const assertion of group) {
          results.push(assertionResult(assertion, url, 'blocked', blockedDetail));
        }
        if (navError === 'browser-unavailable') break;
        continue;
      }
      const navTitle = titleFromNavigate(navOut);
      await delay(settleMs, input.signal);

      if (captureScreenshots) {
        // Evidence for the human report. Explicitly not an assertion: a
        // screenshot that fails to capture must never move the verdict.
        try {
          const shot = await callTool('browser_drive_screenshot', {});
          const id = /^screenshot:\s*(\S+)$/m.exec(shot)?.[1];
          if (id) screenshots.push({ id, path: group[0].path, url });
        } catch {
          /* evidence only */
        }
      }

      for (const assertion of group) {
        if (input.signal?.aborted) {
          results.push(assertionResult(assertion, url, 'blocked', 'the run was stopped'));
          blockedReason = blockedReason ?? 'aborted';
          continue;
        }
        const verdict = await evaluateAssertion({
          assertion,
          url,
          navTitle,
          callTool,
          assertTimeoutMs,
          signal: input.signal,
        });
        if (verdict.outcome === 'blocked' && verdict.reason) {
          blockedReason = blockedReason ?? verdict.reason;
          blockedDetail = blockedDetail || verdict.detail;
        }
        results.push(assertionResult(assertion, url, verdict.outcome, verdict.detail));
        if (verdict.reason === 'browser-unavailable') {
          blockedReason = 'browser-unavailable';
          break;
        }
      }
    }
  } catch (err) {
    // A driver crash is `blocked`. It says nothing about the app.
    blockedReason = blockedReason ?? 'driver-error';
    blockedDetail = blockedDetail || (err instanceof Error ? err.message : String(err));
  } finally {
    // Teardown is unconditional and covers both processes. An unattended run
    // that leaks a Chromium or a dev server per board is a machine that stops
    // working overnight.
    try {
      await closeBrowser(cwd);
    } catch {
      /* the driver's watchdog and orphan drain are the backstop */
    }
    if (started.ok && started.startedHere && app) {
      try {
        // Not `input.signal`: an aborted run must still wait for its own
        // server to release the port, or the next run inherits the race.
        await app.stop(cwd, { portReleaseTimeoutMs: input.portReleaseTimeoutMs });
      } catch {
        /* best-effort; the dev-server manager kills the tree on its own too */
      }
    }
  }

  // Any assertion that ran and did not hold is a real failure, and outranks a
  // blocked sibling: a fail is information, blocked is the absence of it.
  const failed = results.filter((r) => r.outcome === 'fail');
  const blockedAssertions = results.filter((r) => r.outcome === 'blocked');
  const passed = results.filter((r) => r.outcome === 'pass');

  if (failed.length > 0) {
    const first = failed[0];
    return {
      status: 'fail',
      reason: null,
      summary:
        `Browser rung failed: ${first.describe} at ${first.url} — ${first.detail}. ` +
        `${failed.length} of ${results.length} derived assertions did not hold.`,
      runInstructions: formatBrowserRunInstructions({
        command: appCommand,
        cwd,
        url: first.url,
        steps: [
          'start the app with the command above, in that cwd',
          `open ${first.url}`,
          `expect: ${first.describe}`,
          `observed: ${first.detail}`,
          ...(first.taskId ? [`the criterion is task ${first.taskId}'s Accept: ${first.criterion}`] : []),
        ],
      }),
      url: first.url,
      appCommand,
      port: started.port ?? null,
      assertions: results,
      notObservable: derived.notObservable,
      screenshots,
    };
  }

  if (blockedReason || blockedAssertions.length > 0) {
    const reason = blockedReason ?? 'driver-error';
    const detail = blockedDetail || blockedAssertions[0]?.detail || 'the browser check could not run';
    return {
      status: 'blocked',
      reason,
      summary:
        `Browser rung blocked (${reason}): ${detail}. ` +
        `${passed.length} of ${results.length} derived assertions ran. ` +
        'The static ladder was green; this is not a regression.',
      runInstructions: formatBrowserRunInstructions({
        command: appCommand,
        cwd,
        url: baseUrl,
        steps: [
          'start the app with the command above, in that cwd',
          `open ${baseUrl}`,
          `the browser check could not run here: ${detail}`,
        ],
      }),
      url: baseUrl,
      appCommand,
      port: started.port ?? null,
      assertions: results,
      notObservable: derived.notObservable,
      screenshots,
    };
  }

  return {
    status: 'pass',
    reason: null,
    summary:
      `Browser rung passed: ${passed.length} derived assertion${passed.length === 1 ? '' : 's'} ` +
      `held against the running app at ${baseUrl}.` +
      (derived.notObservable.length > 0
        ? ` ${derived.notObservable.length} criteria were not browser-observable and were not checked.`
        : ''),
    runInstructions: formatBrowserRunInstructions({
      command: appCommand,
      cwd,
      url: baseUrl,
      steps: [
        'start the app with the command above, in that cwd',
        `open ${baseUrl}`,
        ...results.map((r) => `expect: ${r.describe} at ${r.url}`),
      ],
    }),
    url: baseUrl,
    appCommand,
    port: started.port ?? null,
    assertions: results,
    notObservable: derived.notObservable,
    screenshots,
  };
}

/**
 * Evaluate one assertion against the currently-open page.
 *
 * Positive assertions poll to a deadline; negative ones are read once, after
 * the caller's settle window. Both give the same verdict on every run against
 * an unchanged app — only the time taken differs.
 *
 * @param {{
 *   assertion: BrowserAssertion,
 *   url: string,
 *   navTitle: string | null,
 *   callTool: (name: string, args?: Record<string, unknown>) => Promise<string>,
 *   assertTimeoutMs: number,
 *   signal?: AbortSignal,
 * }} input
 * @returns {Promise<{ outcome: 'pass' | 'fail' | 'blocked', detail: string, reason?: string }>}
 */
async function evaluateAssertion(input) {
  const { assertion, url, callTool, assertTimeoutMs, signal } = input;
  const needle = normalizeForMatch(assertion.expected);

  /**
   * @param {() => Promise<{ done: boolean, detail: string } | { blocked: string, detail: string }>} probe
   * @param {boolean} poll
   */
  const run = async (probe, poll) => {
    const deadline = Date.now() + (poll ? assertTimeoutMs : 0);
    /** @type {string} */
    let lastDetail = 'no read was taken';
    for (;;) {
      const outcome = await probe();
      if ('blocked' in outcome) {
        return { outcome: /** @type {const} */ ('blocked'), detail: outcome.detail, reason: outcome.blocked };
      }
      lastDetail = outcome.detail;
      if (outcome.done) return { outcome: /** @type {const} */ ('pass'), detail: outcome.detail };
      if (!poll || Date.now() >= deadline || signal?.aborted) break;
      await delay(POLL_INTERVAL_MS, signal);
    }
    return { outcome: /** @type {const} */ ('fail'), detail: lastDetail };
  };

  if (assertion.kind === 'title') {
    const title = input.navTitle ?? '';
    const ok = normalizeForMatch(title).includes(needle);
    return ok
      ? { outcome: 'pass', detail: `title was ${JSON.stringify(title)}` }
      : { outcome: 'fail', detail: `title was ${JSON.stringify(title)}` };
  }

  if (assertion.kind === 'console-clean') {
    const out = await callTool('browser_drive_read_console', { level: 'error' });
    const err = classifyToolError(out);
    if (err) return { outcome: 'blocked', detail: out.split('\n')[0], reason: err };
    if (out.startsWith('console: (no entries)')) {
      return { outcome: 'pass', detail: 'no console error entries' };
    }
    const lines = out.split('\n').filter((l) => l.startsWith('[')).slice(0, 3);
    return { outcome: 'fail', detail: `console errors: ${lines.join(' | ') || out.split('\n')[0]}` };
  }

  if (assertion.kind === 'http-status') {
    return run(async () => {
      const out = await callTool('browser_drive_read_network', {});
      const err = classifyToolError(out);
      if (err) return { blocked: err, detail: out.split('\n')[0] };
      const status = statusForUrl(out, url);
      if (status === null) return { done: false, detail: `no recorded request for ${url}` };
      return { done: status === assertion.expected, detail: `status was ${status}` };
    }, true);
  }

  if (assertion.kind === 'absent-text') {
    const out = await callTool('browser_drive_read_page', { mode: 'text' });
    const err = classifyToolError(out);
    if (err) return { outcome: 'blocked', detail: out.split('\n')[0], reason: err };
    const body = normalizeForMatch(pageBody(out));
    return body.includes(needle)
      ? { outcome: 'fail', detail: `page text still contains ${JSON.stringify(assertion.expected)}` }
      : { outcome: 'pass', detail: `page text does not contain ${JSON.stringify(assertion.expected)}` };
  }

  // kind === 'text'
  return run(async () => {
    const out = await callTool('browser_drive_read_page', { mode: 'text' });
    const err = classifyToolError(out);
    if (err) return { blocked: err, detail: out.split('\n')[0] };
    const body = normalizeForMatch(pageBody(out));
    return {
      done: body.includes(needle),
      detail: body.includes(needle)
        ? `page text contains ${JSON.stringify(assertion.expected)}`
        : `page text did not contain ${JSON.stringify(assertion.expected)} within the assertion window`,
    };
  }, true);
}
