/**
 * P5-A — The browser session the server drives (MIN-719).
 *
 * `launchBrowser()` returns a **result**, never a bare throw for the two cases
 * the ladder has to degrade on: no browser installed, and browser automation
 * disabled in settings. Everything else is a typed rejection.
 *
 * Containment, in three independent layers, because a Final Tester running
 * unattended at 3am has nobody to unstick it:
 *
 *   1. every CDP command carries a deadline;
 *   2. a navigation that misses its deadline triggers a browser-level liveness
 *      probe — a slow page keeps the session, a dead browser is killed;
 *   3. an absolute `hardTimeoutMs` watchdog kills the browser regardless.
 *
 * After any kill the profile directory is removed and the session is `dead`;
 * every later call rejects immediately rather than waiting on a socket that
 * will never answer.
 *
 * P5-B wraps this as tools. It is deliberately not a tool surface itself: no
 * string formatting for models, no tool-call error prefixes, no prompt text.
 */

import { isNavigationAllowed, originFromUrl } from '../cdp/allowlist.js';
import { loadBrowserConfig } from '../cdp/browser-config.js';
import { writeScreenshot } from '../cdp/paths.js';
import { connectTarget } from './cdp-client.js';
import { discoverBrowser } from './discover.js';
import {
  LIVENESS_PROBE_TIMEOUT_MS,
  MAX_CONSOLE_ENTRIES,
  buildLaunchArgs,
  capText,
  normalizeLaunchOptions,
} from './launch-options.js';
import { createProfileDir, removeProfileDir } from './profile.js';
import {
  checkBrowserHealth,
  killBrowserProcess,
  launchBrowserProcess,
  listTargets,
} from './process.js';
import { takeSnapshot } from './snapshot.js';

/** Typed failures a caller may want to branch on. */
export class BrowserDriverError extends Error {
  /**
   * @param {string} message
   * @param {'gone' | 'allowlist' | 'timeout' | 'protocol' | 'closed' | 'invalid'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'BrowserDriverError';
    this.code = code;
  }
}

/**
 * @typedef {'user' | 'hard-timeout' | 'unresponsive' | 'external' | 'launch-failure'} SessionEndReason
 *
 * @typedef {object} SessionStatus
 * @property {boolean} alive
 * @property {number} pid
 * @property {number} port
 * @property {string} profileDir
 * @property {string} executablePath
 * @property {string} browserVersion
 * @property {SessionEndReason | null} endedReason
 * @property {string | null} endedDetail
 * @property {string | null} currentUrl
 */

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

export class BrowserSession {
  /**
   * @param {object} input
   * @param {import('./process.js').BrowserProcessHandle} input.handle
   * @param {import('./cdp-client.js').CdpClient} input.client
   * @param {string} input.targetId
   * @param {import('./launch-options.js').NormalizedLaunchOptions} input.options
   * @param {string[]} input.allowedOriginPatterns
   * @param {string} input.browserVersion
   * @param {boolean} input.ownsProfileDir
   */
  constructor(input) {
    this.handle = input.handle;
    this.client = input.client;
    this.targetId = input.targetId;
    this.options = input.options;
    this.allowedOriginPatterns = input.allowedOriginPatterns;
    this.browserVersion = input.browserVersion;
    this.ownsProfileDir = input.ownsProfileDir;

    this.alive = true;
    /** @type {SessionEndReason | null} */
    this.endedReason = null;
    /** @type {string | null} */
    this.endedDetail = null;
    /** @type {string | null} */
    this.currentUrl = null;
    /** @type {import('./snapshot.js').Snapshot | null} */
    this.lastSnapshot = null;
    /** @type {Array<{ level: string, text: string, at: number }>} */
    this.console = [];
    /** @type {Promise<void> | null} */
    this.closing = null;

    this.handle.child.on('exit', () => {
      // The browser died without us asking. Record it; do not throw from here —
      // an exit listener that throws takes the host process with it.
      if (this.alive) this.#markDead('external', 'the browser process exited unexpectedly');
    });
    this.hardTimer = setTimeout(() => {
      void this.kill('hard-timeout', `session exceeded hardTimeoutMs=${this.options.hardTimeoutMs}`);
    }, this.options.hardTimeoutMs);
    if (typeof this.hardTimer.unref === 'function') this.hardTimer.unref();

    // …and if it died in the gap between launching and getting here, the
    // listener above will never fire, so check once directly.
    if (this.handle.child.exitCode !== null || this.handle.child.signalCode !== null) {
      this.#markDead('external', 'the browser process exited unexpectedly');
    }
  }

  /**
   * @param {SessionEndReason} reason
   * @param {string} detail
   */
  #markDead(reason, detail) {
    if (!this.alive) return;
    this.alive = false;
    this.endedReason = reason;
    this.endedDetail = detail;
    clearTimeout(this.hardTimer);
    try {
      this.client.close(`browser session ended: ${reason}`);
    } catch {
      /* ignore */
    }
  }

  #assertAlive() {
    if (!this.alive) {
      throw new BrowserDriverError(
        `browser session is not usable: ${this.endedReason ?? 'ended'}` +
          (this.endedDetail ? ` (${this.endedDetail})` : ''),
        'gone',
      );
    }
  }

  /** @returns {SessionStatus} */
  status() {
    return {
      alive: this.alive,
      pid: this.handle.pid,
      port: this.handle.port,
      profileDir: this.handle.profileDir,
      executablePath: this.handle.executablePath,
      browserVersion: this.browserVersion,
      endedReason: this.endedReason,
      endedDetail: this.endedDetail,
      currentUrl: this.currentUrl,
    };
  }

  /**
   * Is the browser itself answering, independent of whatever the page is doing?
   *
   * This is the question that separates "the page is slow" from "the browser is
   * wedged", and it is answered over HTTP, not over the page's own execution
   * context, so a spinning renderer cannot mask a healthy browser or vice versa.
   *
   * @returns {Promise<boolean>}
   */
  async isResponsive() {
    if (!this.alive) return false;
    const health = await checkBrowserHealth(this.handle.port, LIVENESS_PROBE_TIMEOUT_MS);
    return health.ok;
  }

  /**
   * Append to the console ring buffer. Public because `launchBrowser` wires the
   * CDP listeners after construction; not part of the API P5-B should call.
   * @param {string} level
   * @param {string} text
   */
  recordConsoleEntry(level, text) {
    this.console.push({ level, text: capText(text, 2_000), at: Date.now() });
    if (this.console.length > MAX_CONSOLE_ENTRIES) this.console.shift();
  }

  /** Console, `Log` entries, and uncaught exceptions collected since launch. */
  consoleMessages() {
    return this.console.map((entry) => ({ ...entry }));
  }

  /**
   * Navigate, subject to the browser allowlist.
   *
   * Returns `{ outcome: 'loaded' }` or `{ outcome: 'timeout' }`. A timeout is
   * **not** automatically fatal: the load event may simply be late, and the DOM
   * is often readable anyway. What is fatal is a browser that stops answering,
   * and that is checked explicitly.
   *
   * @param {string} url
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<{ outcome: 'loaded' | 'timeout', url: string, title: string, killed?: boolean }>}
   */
  async navigate(url, opts = {}) {
    this.#assertAlive();
    const target = String(url ?? '').trim();
    if (!target) throw new BrowserDriverError('url is required', 'invalid');
    let origin;
    try {
      origin = originFromUrl(target);
    } catch {
      throw new BrowserDriverError(`invalid url: ${target}`, 'invalid');
    }
    if (!isNavigationAllowed(target, this.allowedOriginPatterns)) {
      throw new BrowserDriverError(
        `navigation blocked by allowlist: ${origin}. ` +
          'Add the origin under Settings → Browser (browser.allowedOriginPatterns) to allow it.',
        'allowlist',
      );
    }

    const timeoutMs = opts.timeoutMs ?? this.options.navigationTimeoutMs;
    const startedAt = Date.now();
    const remaining = () => Math.max(0, timeoutMs - (Date.now() - startedAt));

    let loaded = false;
    /** @type {(() => void) | null} */
    let resolveLoad = null;
    const loadPromise = new Promise((resolve) => {
      resolveLoad = () => {
        loaded = true;
        resolve(undefined);
      };
    });
    /** @type {(params: Record<string, unknown>) => void} */
    const onLoad = () => resolveLoad?.();
    this.client.on('Page.loadEventFired', onLoad);

    this.lastSnapshot = null;
    try {
      // `Page.navigate` does not acknowledge until the navigation commits, so a
      // server that accepts the connection and never answers hangs the *command*,
      // not just the load event. It therefore gets the navigation deadline, and
      // its rejection is absorbed here — an unhandled one would take the host
      // process down a quarter of an hour after the caller had already moved on.
      const ack = this.client.send('Page.navigate', { url: target }, { timeoutMs: timeoutMs + 1_000 });
      ack.catch(() => {});
      const acked = await Promise.race([
        ack.then(
          () => /** @type {const} */ ('ok'),
          (err) => (err?.code === 'closed' ? /** @type {const} */ ('closed') : /** @type {const} */ ('stalled')),
        ),
        delay(timeoutMs).then(() => /** @type {const} */ ('stalled')),
      ]);

      if (acked === 'closed') {
        throw new BrowserDriverError(`browser connection closed while navigating to ${target}`, 'gone');
      }
      if (acked === 'ok') {
        await Promise.race([loadPromise, delay(remaining())]);
      }
    } finally {
      this.client.off('Page.loadEventFired', onLoad);
    }

    if (!loaded) {
      // Stop the load so the DOM settles at whatever it managed, then find out
      // whether the browser is merely busy or actually gone.
      try {
        await this.client.send('Page.stopLoading', {}, { timeoutMs: LIVENESS_PROBE_TIMEOUT_MS });
      } catch {
        /* the probe below is the real verdict */
      }
      const responsive = await this.isResponsive();
      if (!responsive) {
        await this.kill('unresponsive', `browser stopped answering while loading ${target}`);
        return { outcome: 'timeout', url: target, title: '', killed: true };
      }
      this.currentUrl = target;
      const title = await this.#safeTitle();
      return { outcome: 'timeout', url: target, title };
    }

    this.currentUrl = target;
    return { outcome: 'loaded', url: target, title: await this.#safeTitle() };
  }

  /** @returns {Promise<string>} */
  async #safeTitle() {
    try {
      const value = await this.evaluate('document.title');
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  }

  /**
   * Evaluate an expression in the page and return it by value.
   *
   * `awaitPromise` is off by default: a promise that never settles is the most
   * common way to wedge a driver, and the caller who genuinely needs one can
   * opt in with its own deadline.
   *
   * @param {string} expression
   * @param {{ timeoutMs?: number, awaitPromise?: boolean }} [opts]
   * @returns {Promise<unknown>}
   */
  async evaluate(expression, opts = {}) {
    this.#assertAlive();
    const result = await this.client.send(
      'Runtime.evaluate',
      {
        expression: String(expression),
        returnByValue: true,
        awaitPromise: opts.awaitPromise === true,
      },
      { timeoutMs: opts.timeoutMs ?? this.options.commandTimeoutMs },
    );
    const exception = /** @type {any} */ (result).exceptionDetails;
    if (exception) {
      const text = exception.exception?.description ?? exception.text ?? 'evaluation threw';
      throw new BrowserDriverError(`page evaluation failed: ${text}`, 'protocol');
    }
    return /** @type {any} */ (result).result?.value;
  }

  /**
   * Visible text of the page body.
   * @param {{ maxChars?: number, timeoutMs?: number }} [opts]
   * @returns {Promise<string>}
   */
  async text(opts = {}) {
    const value = await this.evaluate(
      'document.body ? document.body.innerText : ""',
      { timeoutMs: opts.timeoutMs },
    );
    return capText(typeof value === 'string' ? value : String(value ?? ''), opts.maxChars);
  }

  /**
   * Serialized DOM.
   * @param {{ maxChars?: number, timeoutMs?: number }} [opts]
   * @returns {Promise<string>}
   */
  async html(opts = {}) {
    const value = await this.evaluate(
      'document.documentElement ? document.documentElement.outerHTML : ""',
      { timeoutMs: opts.timeoutMs },
    );
    return capText(typeof value === 'string' ? value : String(value ?? ''), opts.maxChars);
  }

  /**
   * Accessibility tree with stable uids. The uids are what a later interaction
   * API (P5-B) resolves against, so the snapshot is retained on the session.
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<import('./snapshot.js').Snapshot>}
   */
  async snapshot(opts = {}) {
    this.#assertAlive();
    await this.client.send('Accessibility.enable', {}, { timeoutMs: this.options.commandTimeoutMs });
    const snap = await takeSnapshot(this.client, {
      timeoutMs: opts.timeoutMs ?? this.options.commandTimeoutMs,
    });
    this.lastSnapshot = snap;
    return snap;
  }

  /**
   * PNG to `~/.minnow/screenshots/`, served by the existing
   * `/api/browser/screenshot/:id` route.
   *
   * **Evidence only.** Nothing in the driver or its tests asserts on a
   * screenshot — the known hazard is that these round-trips hang, so this is a
   * best-effort artefact for a human, with its own deadline, and a failure here
   * is returned rather than thrown.
   *
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<{ ok: true, id: string, filePath: string, sizeBytes: number } | { ok: false, error: string }>}
   */
  async screenshot(opts = {}) {
    if (!this.alive) return { ok: false, error: 'browser session is not usable' };
    try {
      const result = await this.client.send(
        'Page.captureScreenshot',
        { format: 'png' },
        { timeoutMs: opts.timeoutMs ?? this.options.commandTimeoutMs },
      );
      const data = /** @type {any} */ (result).data;
      if (typeof data !== 'string' || !data) {
        return { ok: false, error: 'browser returned no screenshot data' };
      }
      const written = await writeScreenshot(Buffer.from(data, 'base64'));
      return { ok: true, ...written };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Force-kill the browser and tear the profile down. Idempotent, never throws.
   * @param {SessionEndReason} [reason]
   * @param {string} [detail]
   * @returns {Promise<SessionStatus>}
   */
  async kill(reason = 'user', detail = '') {
    if (this.closing) {
      await this.closing;
      return this.status();
    }
    this.closing = (async () => {
      this.#markDead(reason, detail || `session ended (${reason})`);
      await killBrowserProcess(this.handle.child);
      if (this.ownsProfileDir) await removeProfileDir(this.handle.profileDir);
    })();
    await this.closing;
    return this.status();
  }

  /**
   * Normal shutdown. Same path as {@link kill} — Chromium's `Browser.close` is
   * a courtesy that a wedged browser ignores, and a driver that waits on a
   * courtesy is a driver that hangs.
   * @returns {Promise<SessionStatus>}
   */
  async close() {
    return this.kill('user', 'closed by caller');
  }
}

/**
 * @typedef {object} LaunchSuccess
 * @property {true} ok
 * @property {BrowserSession} session
 * @property {import('./discover.js').BrowserCapabilityAvailable} capability
 *
 * @typedef {object} LaunchFailure
 * @property {false} ok
 * @property {'disabled-in-settings' | 'no-chromium-browser' | 'env-path-missing' | 'launch-failed'} reason
 * @property {string} detail
 *
 * @typedef {LaunchSuccess | LaunchFailure} LaunchResult
 */

/**
 * Launch an isolated browser and attach to its first page target.
 *
 * Returns a result rather than throwing for every case the ladder must degrade
 * on. A machine with no browser, or a user who turned automation off, gets
 * `{ ok: false, reason }` — not an exception, and certainly not a failed run.
 *
 * @param {import('./launch-options.js').LaunchOptions & { label?: string }} [opts]
 * @returns {Promise<LaunchResult>}
 */
export async function launchBrowser(opts = {}) {
  const options = normalizeLaunchOptions(opts);

  /** @type {string[]} */
  let allowedOriginPatterns;
  let enabled = true;
  try {
    const cfg = await loadBrowserConfig();
    enabled = cfg.enabled !== false;
    allowedOriginPatterns = opts.allowedOriginPatterns ?? cfg.allowedOriginPatterns;
  } catch {
    allowedOriginPatterns = opts.allowedOriginPatterns ?? [];
  }
  if (!enabled) {
    return {
      ok: false,
      reason: 'disabled-in-settings',
      detail: 'browser automation is disabled in settings (browser.enabled = false)',
    };
  }

  const capability = await discoverBrowser({
    executablePath: opts.executablePath,
    env: opts.env,
  });
  if (!capability.available) {
    return { ok: false, reason: capability.reason, detail: capability.detail };
  }

  const ownsProfileDir = !opts.profileDir;
  const profileDir = opts.profileDir ?? (await createProfileDir(opts.label));

  /** @type {import('./process.js').BrowserProcessHandle} */
  let handle;
  try {
    handle = await launchBrowserProcess({
      executablePath: capability.executablePath,
      profileDir,
      args: buildLaunchArgs({ profileDir, options }),
      launchTimeoutMs: options.launchTimeoutMs,
    });
  } catch (err) {
    if (ownsProfileDir) await removeProfileDir(profileDir);
    return {
      ok: false,
      reason: 'launch-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const health = await checkBrowserHealth(handle.port);
    const targets = await listTargets(handle.port);
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw new Error('browser started but exposed no page target');

    const client = await connectTarget(page.webSocketDebuggerUrl, {
      commandTimeoutMs: options.commandTimeoutMs,
      connectTimeoutMs: options.launchTimeoutMs,
    });

    const session = new BrowserSession({
      handle,
      client,
      targetId: page.id,
      options,
      allowedOriginPatterns,
      browserVersion: health.ok ? health.version : 'unknown',
      ownsProfileDir,
    });

    // Console + errors are the assertion surface the issue asks for, so they are
    // wired before the caller gets the session and can navigate anywhere.
    client.on('Runtime.consoleAPICalled', (params) => {
      const args = /** @type {any[]} */ (params.args ?? []);
      const text = args
        .map((a) => (a?.value !== undefined ? String(a.value) : String(a?.description ?? '')))
        .join(' ');
      session.recordConsoleEntry(String(params.type ?? 'log'), text);
    });
    client.on('Runtime.exceptionThrown', (params) => {
      const details = /** @type {any} */ (params.exceptionDetails ?? {});
      session.recordConsoleEntry(
        'exception',
        String(details.exception?.description ?? details.text ?? 'uncaught exception'),
      );
    });
    client.on('Log.entryAdded', (params) => {
      const entry = /** @type {any} */ (params.entry ?? {});
      session.recordConsoleEntry(String(entry.level ?? 'log'), String(entry.text ?? ''));
    });

    await client.send('Page.enable', {}, { timeoutMs: options.commandTimeoutMs });
    await client.send('Runtime.enable', {}, { timeoutMs: options.commandTimeoutMs });
    try {
      await client.send('Log.enable', {}, { timeoutMs: options.commandTimeoutMs });
    } catch {
      // Log domain is optional; console + exceptions already cover the ladder.
    }

    return { ok: true, session, capability };
  } catch (err) {
    await killBrowserProcess(handle.child);
    if (ownsProfileDir) await removeProfileDir(profileDir);
    return {
      ok: false,
      reason: 'launch-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
