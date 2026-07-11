/**
 * Element → source mapping (MIN-369): best-effort file:line resolution for a Design Mode pick,
 * run async right after the elementRef chip is pushed so the pick itself is never blocked or
 * delayed. Ladder (cheapest/most-confident first):
 *  1. Static HTML workspace — GET /api/design/source-map (server/design/source-map-routes.js),
 *     which matches a distinctive signal (id > class combo > outerHTML slice) against the
 *     served workspace file (`previewSource.path` is already the file — the server only needs
 *     to find `:line`).
 *  2. Framework dev server — read React DevTools fiber (`_debugSource`) or Vue/`data-source`
 *     debug attributes off the live element via the picker's execJs transport.
 *  3. Fallback — no file/line, just `{ confidence: 'guess' }`; the selector already carried on
 *     the elementRef attachment doubles as the "nearest landmark" context.
 * Every step is wrapped so a failure anywhere falls through to the next; this function never
 * throws and never leaves a pick without at least a 'guess' mapping.
 */
import type { PickerTransport } from './element-picker';

export type SourceMapConfidence = 'exact' | 'probable' | 'guess';

/** Resolved (or best-effort-failed) element → source location, attached to an elementRef chip. */
export interface SourceMapping {
  /** Workspace-relative path (static ladder) or dev-server-reported file path. */
  file?: string;
  /** 1-based line number, when known. */
  line?: number;
  /** Component/tag name reported by a framework's debug attributes. */
  component?: string;
  confidence: SourceMapConfidence;
}

/** Picked-element fields the resolution ladder needs (subset of ElementRefInput). */
export interface SourceMapInput {
  selector: string;
  pageUrl: string;
  tagName: string;
  classList: string[];
  outerHtmlPreview: string;
}

const GUESS: SourceMapping = { confidence: 'guess' };

function extractIdAttr(outerHtml: string): string {
  const match = /\bid=["']([^"']+)["']/.exec(outerHtml);
  return match ? match[1] : '';
}

/** True for a workspace-relative static HTML page (the only page kind step 1 can resolve). */
function isStaticHtmlPage(pageUrl: string): boolean {
  const path = pageUrl.split(/[?#]/)[0]?.trim() ?? '';
  return /\.html?$/i.test(path);
}

interface StaticSourceMapResponse {
  file?: string;
  line?: number;
  confidence?: string;
}

/** Step 1: static HTML workspace file:line lookup via the server matcher. */
async function resolveStaticSource(input: SourceMapInput): Promise<SourceMapping | null> {
  if (!isStaticHtmlPage(input.pageUrl)) return null;
  const params = new URLSearchParams({
    page: input.pageUrl,
    tag: input.tagName,
    id: extractIdAttr(input.outerHtmlPreview),
    classes: input.classList.join(' '),
    html: input.outerHtmlPreview.slice(0, 120),
  });
  const res = await fetch(`/api/design/source-map?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as StaticSourceMapResponse;
  if (!data || typeof data.file !== 'string' || typeof data.line !== 'number') return null;
  return { file: data.file, line: data.line, confidence: data.confidence === 'exact' ? 'exact' : 'probable' };
}

/** In-guest debug-attribute reader for step 2 (framework dev servers). */
function devServerSourceScript(selector: string): string {
  return `(() => {
  try {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const fiberKey = Object.keys(el).find((k) => k.indexOf('__reactFiber$') === 0);
    if (fiberKey) {
      let fiber = el[fiberKey];
      for (let i = 0; i < 8 && fiber; i += 1) {
        const src = fiber._debugSource || (fiber._debugOwner && fiber._debugOwner._debugSource);
        if (src && src.fileName) {
          const type = fiber.type;
          const name = (type && (type.displayName || type.name)) || undefined;
          return { file: src.fileName, line: src.lineNumber || undefined, component: name };
        }
        fiber = fiber.return;
      }
    }
    if (el.__vue__) {
      const opts = el.__vue__.$options || {};
      const file = opts.__file;
      if (file) return { file, component: opts.name || opts._componentTag || undefined };
    }
    const dataSource =
      el.getAttribute('data-source') ||
      el.getAttribute('data-__source') ||
      el.getAttribute('data-v-inspector');
    if (dataSource) {
      const m = /^(.*):(\\d+)(?::(\\d+))?$/.exec(dataSource);
      if (m) return { file: m[1], line: Number(m[2]) };
      return { file: dataSource };
    }
    return null;
  } catch {
    return null;
  }
})()`;
}

interface DevServerSourceRaw {
  file?: unknown;
  line?: unknown;
  component?: unknown;
}

/** Step 2: framework dev-server debug attributes, read live via the picker transport. */
async function resolveDevServerSource(
  input: SourceMapInput,
  transport: PickerTransport | null,
): Promise<SourceMapping | null> {
  if (!transport) return null;
  const raw = await transport.eval(devServerSourceScript(input.selector));
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as DevServerSourceRaw;
  const file = typeof row.file === 'string' ? row.file : undefined;
  const component = typeof row.component === 'string' ? row.component : undefined;
  if (!file && !component) return null;
  const line = typeof row.line === 'number' && Number.isFinite(row.line) ? row.line : undefined;
  return { file, line, component, confidence: 'probable' };
}

/**
 * Best-effort element → source resolution, run async after the pick lands. Always resolves
 * (never rejects) — a failure at any ladder step just falls through, and the final fallback is
 * `{ confidence: 'guess' }` rather than null so a caller can always upgrade the chip in place.
 */
export async function resolveElementSourceMapping(
  input: SourceMapInput,
  transport: PickerTransport | null,
): Promise<SourceMapping> {
  try {
    const staticMatch = await resolveStaticSource(input);
    if (staticMatch) return staticMatch;
  } catch {
    /* fall through to the dev-server ladder */
  }
  try {
    const devMatch = await resolveDevServerSource(input, transport);
    if (devMatch) return devMatch;
  } catch {
    /* fall through to the guess fallback */
  }
  return GUESS;
}
