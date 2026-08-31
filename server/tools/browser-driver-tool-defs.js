/**
 * P5-B — Names and OpenAI function schemas for the browser driver tools (MIN-720).
 *
 * Pure data, zero imports. Two very different modules need the *names*:
 *
 *  - `server/tools/browser-driver-tools.js` — the handlers, which pull in the
 *    driver, the allowlist, and the screenshot writer;
 *  - `server/runner/tool-set.js` — the id lists, which are re-exported from the
 *    isomorphic `server/runner/index.js` barrel that **Vite follows into the
 *    renderer bundle**.
 *
 * Keeping the names in one dependency-free file is what stops the second from
 * dragging the first into the client build (the same trap `server/runner/node.js`
 * documents), while still having a single source of truth for the surface.
 *
 * The renderer's own `browser_*` tools (`src/tools/browser-preview-tools.ts`)
 * are a different, Electron-bound surface. These are deliberately named
 * `browser_drive_*` so the two never collide: `browser_navigate` and friends
 * are listed in `RENDERER_ONLY_TOOL_IDS`, and a headless tool list that
 * contained one would be a bug, not a feature.
 */

/** Page-read modes for `browser_drive_read_page`. `a11y` is the assertion surface. */
export const PAGE_READ_MODES = /** @type {const} */ (['a11y', 'text', 'dom']);

/** Console levels `browser_drive_read_console` will filter on. */
export const CONSOLE_LEVELS = /** @type {const} */ ([
  'log',
  'info',
  'warning',
  'error',
  'debug',
  'exception',
]);

export const BROWSER_DRIVE_NAVIGATE = 'browser_drive_navigate';
export const BROWSER_DRIVE_READ_PAGE = 'browser_drive_read_page';
export const BROWSER_DRIVE_CLICK = 'browser_drive_click';
export const BROWSER_DRIVE_TYPE = 'browser_drive_type';
export const BROWSER_DRIVE_READ_CONSOLE = 'browser_drive_read_console';
export const BROWSER_DRIVE_READ_NETWORK = 'browser_drive_read_network';
export const BROWSER_DRIVE_SCREENSHOT = 'browser_drive_screenshot';
export const BROWSER_DRIVE_RESIZE = 'browser_drive_resize';

/**
 * Every browser driver tool id, in the order a Tester naturally uses them.
 * This is the whole surface — a name absent from here is not dispatchable.
 */
export const BROWSER_DRIVER_TOOL_IDS = Object.freeze([
  BROWSER_DRIVE_NAVIGATE,
  BROWSER_DRIVE_READ_PAGE,
  BROWSER_DRIVE_CLICK,
  BROWSER_DRIVE_TYPE,
  BROWSER_DRIVE_READ_CONSOLE,
  BROWSER_DRIVE_READ_NETWORK,
  BROWSER_DRIVE_SCREENSHOT,
  BROWSER_DRIVE_RESIZE,
]);

/** Tools whose output is page-controlled text and must be fenced as untrusted. */
export const BROWSER_DRIVER_UNTRUSTED_TOOL_IDS = Object.freeze([
  BROWSER_DRIVE_READ_PAGE,
  BROWSER_DRIVE_READ_CONSOLE,
  BROWSER_DRIVE_READ_NETWORK,
]);

const TIMEOUT_PROPERTY = {
  type: 'number',
  description:
    'Optional per-call deadline in milliseconds. The call fails on its own; ' +
    'it never fails the attempt.',
};

/**
 * OpenAI-style function definitions.
 *
 * Unlike the rest of the headless set — which the effector stubs as
 * `{ name, description: name, additionalProperties: true }` because the real
 * schemas live in the renderer catalog — these are written out in full. There
 * is no renderer catalog entry for them, and a Final Tester that has to guess
 * the argument names of a browser it cannot see will guess wrong.
 *
 * @type {ReadonlyArray<{
 *   type: 'function',
 *   function: { name: string, description: string, parameters: Record<string, unknown> },
 * }>}
 */
export const BROWSER_DRIVER_TOOL_DEFINITIONS = Object.freeze([
  {
    type: 'function',
    function: {
      name: BROWSER_DRIVE_NAVIGATE,
      description:
        'Open a URL in the headless verification browser, launching it on first use. ' +
        'Subject to the browser navigation allowlist; there is no interactive approval. ' +
        'Returns the load outcome, final URL, and page title.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute URL, e.g. http://localhost:5173/' },
          timeout_ms: TIMEOUT_PROPERTY,
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: BROWSER_DRIVE_READ_PAGE,
      description:
        'Read the current page. This is the assertion surface — assert on this, never on a screenshot. ' +
        'mode="a11y" (default) returns the accessibility tree with [uid] handles for click/type; ' +
        'mode="text" returns visible body text; mode="dom" returns serialized HTML. ' +
        'Output is deterministic for a static page and capped.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [...PAGE_READ_MODES],
            description: 'a11y | text | dom. Defaults to a11y.',
          },
          max_chars: {
            type: 'number',
            description: 'Optional smaller output budget. Cannot raise the shared cap.',
          },
          timeout_ms: TIMEOUT_PROPERTY,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: BROWSER_DRIVE_CLICK,
      description:
        'Click the element with the given [uid] from the most recent ' +
        'browser_drive_read_page(mode="a11y"). The snapshot is invalidated afterwards, ' +
        'so read the page again before the next uid-addressed call.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'number', description: 'A [uid] from the latest a11y read.' },
          timeout_ms: TIMEOUT_PROPERTY,
        },
        required: ['uid'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: BROWSER_DRIVE_TYPE,
      description:
        'Focus the element with the given [uid] and type text into it through the real input ' +
        'pipeline (so framework-controlled inputs update). Replaces existing content unless ' +
        'clear=false. The snapshot is invalidated afterwards.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'number', description: 'A [uid] from the latest a11y read.' },
          text: { type: 'string', description: 'Text to type.' },
          clear: {
            type: 'boolean',
            description: 'Replace the field contents (default true) instead of appending.',
          },
          submit: {
            type: 'boolean',
            description: 'Press Enter after typing (default false).',
          },
          timeout_ms: TIMEOUT_PROPERTY,
        },
        required: ['uid', 'text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: BROWSER_DRIVE_READ_CONSOLE,
      description:
        'Console output, log entries, and uncaught exceptions collected since the browser ' +
        'launched, oldest first. Timestamps are omitted so repeated reads of a settled page ' +
        'are identical.',
      parameters: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: [...CONSOLE_LEVELS],
            description: 'Only entries at this level.',
          },
          limit: { type: 'number', description: 'Keep only the last N entries.' },
          timeout_ms: TIMEOUT_PROPERTY,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: BROWSER_DRIVE_READ_NETWORK,
      description:
        'Requests the page made since launch, as method, status, and URL. Sorted, not ' +
        'time-ordered, and carrying no timings or request ids, so repeated reads of a ' +
        'settled page are identical.',
      parameters: {
        type: 'object',
        properties: {
          failed_only: {
            type: 'boolean',
            description: 'Only requests that failed or returned status >= 400.',
          },
          limit: { type: 'number', description: 'Keep only the first N entries after sorting.' },
          timeout_ms: TIMEOUT_PROPERTY,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: BROWSER_DRIVE_SCREENSHOT,
      description:
        'Save a PNG of the current page for a human report. Evidence only — never assert on ' +
        'a screenshot; use browser_drive_read_page. A capture failure is reported, not fatal.',
      parameters: {
        type: 'object',
        properties: { timeout_ms: TIMEOUT_PROPERTY },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: BROWSER_DRIVE_RESIZE,
      description:
        'Set the viewport size, for checking responsive layout. Invalidates the snapshot.',
      parameters: {
        type: 'object',
        properties: {
          width: { type: 'number', description: 'CSS pixels, 200–4000.' },
          height: { type: 'number', description: 'CSS pixels, 200–4000.' },
          timeout_ms: TIMEOUT_PROPERTY,
        },
        required: ['width', 'height'],
        additionalProperties: false,
      },
    },
  },
]);

/** @type {Readonly<Record<string, (typeof BROWSER_DRIVER_TOOL_DEFINITIONS)[number]>>} */
export const BROWSER_DRIVER_TOOL_DEFINITIONS_BY_NAME = Object.freeze(
  Object.fromEntries(BROWSER_DRIVER_TOOL_DEFINITIONS.map((def) => [def.function.name, def])),
);
