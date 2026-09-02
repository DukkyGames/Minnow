/**
 * Sanitize remote email HTML before cache storage and UI render.
 */

import DOMPurify from 'isomorphic-dompurify';
import { blockRemoteContentHook } from './remote-content.js';

/** Skip caching very large HTML bodies; plain text fallback remains. */
const MAX_HTML_CHARS = 512_000;

/** DOMPurify config tuned for untrusted newsletter / notification HTML. */
const PURIFY_CONFIG = {
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

/**
 * DOMPurify hooks are global — add them only for this call so later outbound mail is not stripped.
 * @param {string | undefined | null} html
 * @param {{ blockRemoteContent?: boolean }} [options]
 * @returns {string | undefined}
 */
export function sanitizeEmailHtml(html, options = {}) {
  const raw = String(html ?? '').trim();
  if (!raw || raw.length > MAX_HTML_CHARS) {
    return undefined;
  }

  if (options.blockRemoteContent) {
    DOMPurify.addHook('afterSanitizeAttributes', blockRemoteContentHook);
  }
  try {
    let clean = DOMPurify.sanitize(raw, PURIFY_CONFIG);
    for (let i = 0; i < 3; i += 1) {
      const next = DOMPurify.sanitize(clean, PURIFY_CONFIG);
      if (next === clean) {
        break;
      }
      clean = next;
    }

    const trimmed = String(clean).trim();
    return trimmed || undefined;
  } finally {
    if (options.blockRemoteContent) {
      DOMPurify.removeHook('afterSanitizeAttributes', blockRemoteContentHook);
    }
  }
}

/**
 * Sanitize a body that arrived from the network. Identical to
 * {@link sanitizeEmailHtml} but with remote content parked, so a stored body
 * can never beacon on render. Use this for anything inbound.
 * @param {string | undefined | null} html
 * @returns {string | undefined}
 */
export function sanitizeInboundEmailHtml(html) {
  return sanitizeEmailHtml(html, { blockRemoteContent: true });
}
