import DOMPurify from 'dompurify';
import type { EmailMessage } from '../../email/client';
import { emailAttachmentPath } from '../../email/client';
import { withSessionToken } from '../../api/session-token';

const EMAIL_PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'rel'],
  FORBID_TAGS: [
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'style',
    'link',
    'base',
    'meta',
    'svg',
    'math',
    'frame',
    'frameset',
    'applet',
    'portal',
  ],
};

/** Mirrors `REMOTE_ATTR_PREFIX` in `server/email/remote-content.js`. */
const REMOTE_ATTR_PREFIX = 'data-minnow-remote-';

/** URL-bearing attributes that trigger a fetch on render. */
const URL_ATTRS = ['src', 'srcset', 'background', 'poster'] as const;

const REMOTE_URL = /^\s*(?:https?:)?\/\//i;
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

type BodySource = Pick<EmailMessage, 'bodyHtml' | 'bodyText' | 'bodyPreview'>;

/** Reader toggle: formatted HTML vs plain-text alternative. */
export type EmailBodyViewMode = 'html' | 'plain';

export interface EmailBodyRenderOptions {
  viewMode?: EmailBodyViewMode;
  /** Re-attach parked images through the local proxy. */
  loadRemoteImages?: boolean;
  /** Recolour the mail to sit in a dark theme via a safe smart-invert (images are re-inverted so they stay right-way-round). */
  matchTheme?: boolean;
  /** Reports how many remote references were withheld, for the "load images" bar. */
  onRemoteContent?: (info: { blockedCount: number }) => void;
  /** Identifies the message so `cid:` parts can be resolved to the attachment route. */
  inlineParts?: { accountId: string; messageKey: string };
}

/** True when the message has both sanitized HTML and a plain-text alternative. */
export function emailBodySupportsViewToggle(message: BodySource): boolean {
  return Boolean(message.bodyHtml?.trim() && (message.bodyText ?? message.bodyPreview ?? '').trim());
}

function isRemoteUrl(value: string | null | undefined): boolean {
  return REMOTE_URL.test(String(value ?? ''));
}

/** Route a remote URL through the local proxy, which strips referrer and cookies. */
function proxied(url: string): string {
  return withSessionToken(`/api/email/image-proxy?url=${encodeURIComponent(url)}`);
}

/** A srcset is a candidate list; proxy each candidate but keep the descriptors. */
function proxiedSrcset(value: string): string {
  return value
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      const url = parts.shift() ?? '';
      if (!isRemoteUrl(url)) return candidate.trim();
      return [proxied(url), ...parts].join(' ');
    })
    .join(', ');
}

function rewriteCssUrls(style: string, load: boolean): { style: string; blocked: number } {
  let blocked = 0;
  const next = style.replace(CSS_URL, (match, _quote, url: string) => {
    if (!isRemoteUrl(url)) return match;
    if (load) return `url("${proxied(url)}")`;
    blocked += 1;
    return 'none';
  });
  return { style: next, blocked };
}

// ── Remote policy ────────────────────────────────────────────────────────────

/** Park or re-attach every remote reference on one element. */
function applyRemotePolicy(el: Element, load: boolean): number {
  let blocked = 0;

  for (const attr of URL_ATTRS) {
    const parkedName = `${REMOTE_ATTR_PREFIX}${attr}`;
    const parked = el.getAttribute(parkedName);
    const live = el.getAttribute(attr);
    const original = parked ?? (isRemoteUrl(live) ? live : null);
    if (!original) continue;

    if (load) {
      el.setAttribute(attr, attr === 'srcset' ? proxiedSrcset(original) : proxied(original));
      el.removeAttribute(parkedName);
    } else {
      el.removeAttribute(attr);
      el.setAttribute(parkedName, original);
      blocked += 1;
    }
  }

  const parkedStyle = el.getAttribute(`${REMOTE_ATTR_PREFIX}style`);
  const liveStyle = el.getAttribute('style');
  const originalStyle = parkedStyle ?? liveStyle;
  if (originalStyle && CSS_URL.test(originalStyle)) {
    CSS_URL.lastIndex = 0;
    const result = rewriteCssUrls(originalStyle, load);
    el.setAttribute('style', result.style);
    if (load) {
      el.removeAttribute(`${REMOTE_ATTR_PREFIX}style`);
    } else if (result.blocked > 0) {
      el.setAttribute(`${REMOTE_ATTR_PREFIX}style`, originalStyle);
      blocked += result.blocked;
    }
  }
  CSS_URL.lastIndex = 0;

  return blocked;
}

export function applyRemoteContentPolicy(root: ParentNode, load: boolean): number {
  let blocked = 0;
  root.querySelectorAll('*').forEach((el) => {
    blocked += applyRemotePolicy(el, load);
    if (el.tagName === 'A') secureLink(el);
  });
  return blocked;
}

// ── CID images ───────────────────────────────────────────────────────────────

/** Point `cid:` image sources at the attachment route. */
export function resolveInlineCidImages(
  root: ParentNode,
  context: { accountId: string; messageKey: string },
): number {
  let resolved = 0;
  root.querySelectorAll('img[src^="cid:"], img[src^="CID:"]').forEach((el) => {
    const raw = el.getAttribute('src') ?? '';
    const cid = raw.slice(4).trim().replace(/^<|>$/g, '');
    if (!cid) return;
    el.setAttribute(
      'src',
      withSessionToken(
        emailAttachmentPath(context.accountId, context.messageKey, `cid:${cid}`, { inline: true }),
      ),
    );
    resolved += 1;
  });
  return resolved;
}

/** Harden external links so a click can't reach back into the app. */
function secureLink(anchor: Element): void {
  const href = anchor.getAttribute('href') ?? '';
  const lower = href.trim().toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:')) {
    anchor.removeAttribute('href');
    return;
  }
  anchor.setAttribute('target', '_blank');
  anchor.setAttribute('rel', 'noopener noreferrer');
}

/** Reset stylesheet for the frame. */
const MAIL_RESET_CSS = `
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1a1a1a;
    /* Mail is drawn for a white page; keep UA controls and scrollbars light
       even when the app around this frame is dark. */
    color-scheme: light;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  body { padding: 12px; }
  img, video { max-width: 100%; height: auto; }
  table { max-width: 100%; border-collapse: collapse; }
  a { color: #0b5fff; }
  blockquote {
    margin: 0 0 0 8px;
    padding-left: 10px;
    border-left: 2px solid #d0d0d0;
    color: #555;
  }
  pre { white-space: pre-wrap; }
  /* Withheld images collapse to a marker instead of a broken-image icon. */
  [${REMOTE_ATTR_PREFIX}src], [${REMOTE_ATTR_PREFIX}srcset] {
    display: inline-block;
    min-width: 12px;
    min-height: 12px;
    background: repeating-linear-gradient(45deg, #f2f2f2, #f2f2f2 4px, #e6e6e6 4px, #e6e6e6 8px);
    border: 1px dashed #c8c8c8;
    border-radius: 2px;
  }
  /* "Match theme": a safe smart-invert for dark reading — the root inverts, then
     media is inverted back so photos and logos stay right-way-round. Best for
     text-dominant mail; the reader defaults to Light. */
  html.mn-dark {
    background: #ffffff;
    filter: invert(1) hue-rotate(180deg);
  }
  html.mn-dark img,
  html.mn-dark video,
  html.mn-dark picture,
  html.mn-dark svg,
  html.mn-dark [background],
  html.mn-dark [style*="background-image"],
  html.mn-dark [style*="background: url"],
  html.mn-dark [style*="background:url"] {
    filter: invert(1) hue-rotate(180deg);
  }
`;

/** Build the frame document. */
function buildSrcdoc(bodyHtml: string, dark: boolean): string {
  const csp = [
    "default-src 'none'",
    "img-src 'self' data: cid:",
    "style-src 'unsafe-inline'",
    'font-src data:',
    "form-action 'none'",
  ].join('; ');

  return [
    `<!doctype html><html${dark ? ' class="mn-dark"' : ''}><head>`,
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    `<style>${MAIL_RESET_CSS}</style>`,
    '</head><body>',
    bodyHtml,
    '</body></html>',
  ].join('');
}

/** Grow the frame to its content so the reading pane scrolls, not the frame. */
function fitFrameToContent(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc?.body) return;
  const height = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0);
  frame.style.height = `${height}px`;
}

// ── Body render ──────────────────────────────────────────────────────────────

/** Render a message body into the reading pane. */
export function renderEmailBody(
  mount: HTMLElement,
  message: BodySource,
  opts: EmailBodyRenderOptions = {},
): void {
  const viewMode = opts.viewMode ?? 'html';

  mount.replaceChildren();
  const html = message.bodyHtml?.trim();
  const plain = message.bodyText ?? message.bodyPreview ?? '';

  if (viewMode === 'plain' && html && plain.trim()) {
    mount.classList.remove('html-body');
    mount.textContent = plain;
    opts.onRemoteContent?.({ blockedCount: 0 });
    return;
  }

  if (!html) {
    mount.classList.remove('html-body');
    mount.textContent = plain;
    opts.onRemoteContent?.({ blockedCount: 0 });
    return;
  }

  mount.classList.add('html-body');
  const clean = DOMPurify.sanitize(html, EMAIL_PURIFY_CONFIG);

  const template = document.createElement('template');
  template.innerHTML = clean;

  const load = opts.loadRemoteImages === true;
  const blockedCount = applyRemoteContentPolicy(template.content, load);
  if (opts.inlineParts) {
    resolveInlineCidImages(template.content, opts.inlineParts);
  }

  const frame = document.createElement('iframe');
  frame.className = 'email-body-frame';
  if (opts.matchTheme) frame.classList.add('email-body-frame--dark');
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', 'Message body');
  frame.srcdoc = buildSrcdoc(template.innerHTML, opts.matchTheme === true);
  frame.addEventListener('load', () => fitFrameToContent(frame));

  mount.appendChild(frame);
  opts.onRemoteContent?.({ blockedCount });
}
