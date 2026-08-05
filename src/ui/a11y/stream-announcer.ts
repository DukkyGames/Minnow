/**
 * Throttled aria-live announcements for streaming assistant prose.
 * DOM updates on every token must not spam screen readers; this region updates on a cadence.
 */

const ANNOUNCE_INTERVAL_MS = 3000;
const COMPLETE_PREFIX = 'Response complete. ';

let announcerEl: HTMLDivElement | null = null;
let announcerDoc: Document | null = null;
let lastAnnouncedAt = 0;
let lastSnippet = '';
let activeWrap: HTMLElement | null = null;

function ensureAnnouncer(doc: Document): HTMLDivElement {
  const existing = doc.getElementById('chatStreamAnnouncer') as HTMLDivElement | null;
  if (existing) return existing;
  const announcerEl = doc.createElement('div');
  announcerEl.id = 'chatStreamAnnouncer';
  announcerEl.className = 'visually-hidden';
  announcerEl.setAttribute('role', 'status');
  announcerEl.setAttribute('aria-live', 'polite');
  announcerEl.setAttribute('aria-atomic', 'true');
  doc.body.appendChild(announcerEl);
  return announcerEl;
}

/** Collapse whitespace and cap length for spoken summaries. */
function summarizeProse(markdown: string): string {
  const flat = markdown.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const max = 120;
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}

/** Begin tracking a streaming assistant row for throttled prose announcements. */
export function beginStreamAnnouncer(wrap: HTMLElement): void {
  activeWrap = wrap;
  lastAnnouncedAt = 0;
  lastSnippet = '';
  wrap.setAttribute('aria-busy', 'true');
}

/** Throttled prose update while tokens stream (call from markdown debounce path). */
export function announceStreamingProse(markdown: string): void {
  if (!activeWrap) return;

  // Rate-limit BEFORE summarizeProse — summarizing the whole reply every tick was O(n²).
  const now = Date.now();
  const isFirst = lastSnippet.length === 0;
  if (!isFirst && now - lastAnnouncedAt < ANNOUNCE_INTERVAL_MS) return;

  const snippet = summarizeProse(markdown);
  if (!snippet) return;
  if (!isFirst && snippet === lastSnippet) return;

  lastAnnouncedAt = now;
  lastSnippet = snippet;
  const doc = activeWrap.ownerDocument;
  announcerDoc = doc;
  announcerEl = ensureAnnouncer(doc);
  announcerEl.textContent = snippet;
}

/** Final announcement when the stream row is finalized. */
export function completeStreamAnnouncer(markdown?: string | null): void {
  const wrapDoc = activeWrap?.ownerDocument;
  if (activeWrap) {
    activeWrap.removeAttribute('aria-busy');
    activeWrap = null;
  }
  const snippet = summarizeProse(markdown ?? lastSnippet);
  lastSnippet = '';
  lastAnnouncedAt = 0;
  const doc = announcerDoc ?? wrapDoc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return;
  const announcer = announcerEl?.isConnected ? announcerEl : ensureAnnouncer(doc);
  if (!snippet) {
    announcer.textContent = 'Response complete.';
    return;
  }
  announcer.textContent = `${COMPLETE_PREFIX}${snippet}`;
}

/** Drop announcer state when a streaming row is removed without completion. */
export function cancelStreamAnnouncer(): void {
  if (activeWrap) {
    activeWrap.removeAttribute('aria-busy');
    activeWrap = null;
  }
  lastSnippet = '';
  lastAnnouncedAt = 0;
}
