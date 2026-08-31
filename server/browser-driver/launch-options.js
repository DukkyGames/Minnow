/**
 * P5-A — Pure option normalization + Chromium argv construction (MIN-719).
 *
 * Separated from `process.js` so the flag set and the timeout policy are
 * testable on bare `node` with no browser, no `ws`, and no node_modules.
 */

/** Absolute session lifetime. Past this the browser is killed regardless of state. */
export const DEFAULT_HARD_TIMEOUT_MS = 300_000;

/** How long to wait for the browser to write `DevToolsActivePort` before giving up. */
export const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;

/** Deadline for a single CDP command. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

/** Deadline for `Page.loadEventFired` after `Page.navigate`. */
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;

/** Deadline for the liveness probe that decides "slow page" vs "dead browser". */
export const LIVENESS_PROBE_TIMEOUT_MS = 5_000;

/** Cap on returned DOM text / HTML, matched to the tool-output cap style. */
export const DEFAULT_MAX_TEXT_CHARS = 20_000;

/** Console ring-buffer size. */
export const MAX_CONSOLE_ENTRIES = 200;

/**
 * @typedef {object} LaunchOptions
 * @property {string} [executablePath]
 * @property {boolean} [headless] default true
 * @property {string} [profileDir] caller-supplied profile dir (else one is minted)
 * @property {number} [hardTimeoutMs]
 * @property {number} [launchTimeoutMs]
 * @property {number} [commandTimeoutMs]
 * @property {number} [navigationTimeoutMs]
 * @property {{ width: number, height: number }} [viewport]
 * @property {string[]} [extraArgs]
 * @property {string[]} [allowedOriginPatterns] override the settings allowlist (tests)
 * @property {Record<string, string | undefined>} [env]
 *
 * @typedef {Required<Pick<LaunchOptions,
 *   'headless' | 'hardTimeoutMs' | 'launchTimeoutMs' | 'commandTimeoutMs' | 'navigationTimeoutMs'
 * >> & { viewport: { width: number, height: number }, extraArgs: string[] }} NormalizedLaunchOptions
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveMs(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * @param {LaunchOptions} [opts]
 * @returns {NormalizedLaunchOptions}
 */
export function normalizeLaunchOptions(opts = {}) {
  const viewport = opts.viewport ?? { width: 1280, height: 800 };
  return {
    headless: opts.headless !== false,
    hardTimeoutMs: positiveMs(opts.hardTimeoutMs, DEFAULT_HARD_TIMEOUT_MS),
    launchTimeoutMs: positiveMs(opts.launchTimeoutMs, DEFAULT_LAUNCH_TIMEOUT_MS),
    commandTimeoutMs: positiveMs(opts.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
    navigationTimeoutMs: positiveMs(opts.navigationTimeoutMs, DEFAULT_NAVIGATION_TIMEOUT_MS),
    viewport: {
      width: positiveMs(viewport.width, 1280),
      height: positiveMs(viewport.height, 800),
    },
    extraArgs: Array.isArray(opts.extraArgs)
      ? opts.extraArgs.filter((a) => typeof a === 'string' && a.length > 0)
      : [],
  };
}

/**
 * Chromium argv for an isolated, unattended session.
 *
 * `--remote-debugging-port=0` is deliberate: the browser picks a free port and
 * writes it to `<profileDir>/DevToolsActivePort`, which we read back. Pinning a
 * port would reintroduce exactly the race the issue warns about with Vite —
 * we determine the port by inspection, never by assumption.
 *
 * @param {{ profileDir: string, options: NormalizedLaunchOptions }} input
 * @returns {string[]}
 */
export function buildLaunchArgs({ profileDir, options }) {
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    // Isolation: nothing shared with the user's own browser, nothing restored,
    // nothing phoned home, no profile picker to block startup.
    '--no-first-run',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--disable-sync',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--metrics-recording-only',
    '--no-pings',
    '--password-store=basic',
    '--use-mock-keychain',
    // Unattended stability: a hidden window must not be throttled or crash on GPU.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--window-size=${options.viewport.width},${options.viewport.height}`,
  ];
  if (options.headless) args.push('--headless=new');
  args.push(...options.extraArgs);
  // A start URL keeps a page target present from the first tick, so the session
  // never has to poll /json/list for a target that does not exist yet.
  args.push('about:blank');
  return args;
}

/**
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function capText(text, max = DEFAULT_MAX_TEXT_CHARS) {
  const str = String(text ?? '');
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n… [truncated ${str.length - max} chars]`;
}
