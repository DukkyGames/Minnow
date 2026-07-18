/**
 * Mail body rendering.
 *
 * Bodies are hostile documents written by strangers, so they are never injected
 * into the app DOM. Each one renders inside a sandboxed iframe with its own
 * reset stylesheet, which fixes three things at once: sender CSS can no longer
 * restyle the app (and app CSS can no longer mangle the mail), a newsletter
 * built for a white background stays readable under a dark app theme, and the
 * frame's CSP gives a second, browser-enforced guarantee that nothing is
 * fetched from the sender's servers.
 *
 * Remote content is parked server-side at sanitize time (see
 * `server/email/remote-content.js`); the same parking is repeated here so that
 * bodies cached before that landed are covered too.
 */

import DOMPurify from 'dompurify';
import type { EmailMessage } from '../../email/client';
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
  /** Reports how many remote references were withheld, for the "load images" bar. */
  onRemoteContent?: (info: { blockedCount: number }) => void;
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

/**
 * Park or re-attach every remote reference on one element.
 * @returns how many references were withheld
 */
function applyRemotePolicy(el: Element, load: boolean): number {
  let blocked = 0;

  for (const attr of URL_ATTRS) {
    const parkedName = `${REMOTE_ATTR_PREFIX}${attr}`;
    // Either the server already parked it, or this is a legacy cached body
    // where the live attribute is still pointing at the sender's host.
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

/**
 * Apply the remote-content policy across a parsed body.
 *
 * Takes an inert root (a `<template>`'s content) so nothing has been fetched by
 * the time it runs.
 *
 * @param load re-attach images through the proxy instead of withholding them
 * @returns how many remote references were withheld
 */
export function applyRemoteContentPolicy(root: ParentNode, load: boolean): number {
  let blocked = 0;
  root.querySelectorAll('*').forEach((el) => {
    blocked += applyRemotePolicy(el, load);
    if (el.tagName === 'A') secureLink(el);
  });
  return blocked;
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

/**
 * Reset stylesheet for the frame.
 *
 * Deliberately theme-independent: mail is authored against a white background,
 * so recolouring it to match a dark app theme is what makes newsletters
 * unreadable. The surface stays light in both themes and the app frame around
 * it carries the theming instead.
 */
const MAIL_RESET_CSS = `
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1a1a1a;
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
`;

/**
 * Build the frame document.
 *
 * The CSP is the backstop for the whole remote-content story: even if the
 * parking above missed an attribute, `img-src` permits only same-origin (the
 * proxy) and inline data, so the sender's host is unreachable from here.
 */
function buildSrcdoc(bodyHtml: string): string {
  const csp = [
    "default-src 'none'",
    "img-src 'self' data: cid:",
    "style-src 'unsafe-inline'",
    'font-src data:',
    "form-action 'none'",
  ].join('; ');

  return [
    '<!doctype html><html><head>',
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

/**
 * Render a message body into the reading pane.
 * Defaults to HTML when available; plain mode shows only the text alternative.
 */
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

  // A <template> fragment is inert: parsing into it does not fetch anything, so
  // the rewrite below happens before any URL could be dereferenced.
  const template = document.createElement('template');
  template.innerHTML = clean;

  const load = opts.loadRemoteImages === true;
  const blockedCount = applyRemoteContentPolicy(template.content, load);

  const frame = document.createElement('iframe');
  frame.className = 'email-body-frame';
  // No allow-scripts, ever. allow-same-origin is what lets us measure the
  // content height; on its own it grants no script execution, but the two
  // together would let the frame reach out of the sandbox.
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', 'Message body');
  frame.srcdoc = buildSrcdoc(template.innerHTML);
  frame.addEventListener('load', () => fitFrameToContent(frame));

  mount.appendChild(frame);
  opts.onRemoteContent?.({ blockedCount });
}
