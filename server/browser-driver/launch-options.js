export const DEFAULT_HARD_TIMEOUT_MS = 300_000;

export const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;

export const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

export const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;

export const LIVENESS_PROBE_TIMEOUT_MS = 5_000;

export const DEFAULT_MAX_TEXT_CHARS = 20_000;

export const MAX_CONSOLE_ENTRIES = 200;

/**
 * @typedef {object} LaunchOptions
 * @property {string} [executablePath]
 * @property {boolean} [headless]
 * @property {string} [profileDir]
 * @property {number} [hardTimeoutMs]
 * @property {number} [launchTimeoutMs]
 * @property {number} [commandTimeoutMs]
 * @property {number} [navigationTimeoutMs]
 * @property {{ width: number, height: number }} [viewport]
 * @property {string[]} [extraArgs]
 * @property {string[]} [allowedOriginPatterns]
 * @property {Record<string, string | undefined>} [env]
 * @typedef {Required<Pick<LaunchOptions, 'headless' | 'hardTimeoutMs' | 'launchTimeoutMs' | 'commandTimeoutMs' | 'navigationTimeoutMs' >> & { viewport: { width: number, height: number }, extraArgs: string[] }} NormalizedLaunchOptions
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
 * @param {{ profileDir: string, options: NormalizedLaunchOptions }} input
 * @returns {string[]}
 */
export function buildLaunchArgs({ profileDir, options }) {
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
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
