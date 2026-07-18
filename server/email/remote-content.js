/**
 * Remote-content blocking for inbound email HTML.
 *
 * A newsletter reaches the network the moment its body renders, so a tracking
 * pixel leaks the reader's IP address and exact read time back to the sender
 * before anyone clicks anything. Every remote URL is therefore stripped while
 * the body is sanitized — before it is ever stored — and parked in a
 * `data-minnow-remote-*` attribute, so a cached body cannot fetch anything on
 * its own no matter how it is later rendered.
 *
 * The reader re-attaches them through the local image proxy once the user asks
 * (`src/ui/email/email-body.ts`, which mirrors the attribute names below).
 */

/** Prefix for every parked URL attribute. Mirrored in `src/ui/email/email-body.ts`. */
export const REMOTE_ATTR_PREFIX = 'data-minnow-remote-';

/** URL-bearing attributes that trigger a fetch on render. */
const URL_ATTRS = ['src', 'srcset', 'background', 'poster'];

/** Matches `http:`, `https:` and protocol-relative `//host` URLs. */
const REMOTE_URL = /^\s*(?:https?:)?\/\//i;

/** Matches a CSS `url(...)` token, quoted or bare. Also catches `image-set()` members. */
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/**
 * `cid:` and `data:` URLs resolve without touching the network, so they stay.
 * @param {string | null | undefined} value
 */
function isRemoteUrl(value) {
  return REMOTE_URL.test(String(value ?? ''));
}

/**
 * A srcset is a candidate list; one remote entry taints the whole attribute,
 * so it is parked wholesale rather than picked apart.
 * @param {string} value
 */
function srcsetHasRemote(value) {
  return String(value)
    .split(',')
    .some((candidate) => isRemoteUrl(candidate.trim().split(/\s+/)[0]));
}

/**
 * Replace remote `url(...)` tokens with `none`, which is valid in every
 * property that accepts a url (background, background-image, list-style-image).
 * @param {string} style
 * @returns {{ style: string, blocked: boolean }}
 */
function stripRemoteCssUrls(style) {
  let blocked = false;
  const next = String(style).replace(CSS_URL, (match, _quote, url) => {
    if (!isRemoteUrl(url)) return match;
    blocked = true;
    return 'none';
  });
  return { style: next, blocked };
}

/**
 * DOMPurify `afterSanitizeAttributes` hook: park every remote reference on the
 * node it came from.
 * @param {Element} node
 */
export function blockRemoteContentHook(node) {
  if (typeof node.getAttribute !== 'function') return;

  for (const attr of URL_ATTRS) {
    if (!node.hasAttribute(attr)) continue;
    const value = node.getAttribute(attr) ?? '';
    const remote = attr === 'srcset' ? srcsetHasRemote(value) : isRemoteUrl(value);
    if (!remote) continue;
    // Remove rather than blank: an empty `src` re-requests the host document
    // in some engines, which is exactly the beacon we are trying to suppress.
    node.removeAttribute(attr);
    node.setAttribute(`${REMOTE_ATTR_PREFIX}${attr}`, value);
  }

  if (node.hasAttribute('style')) {
    const original = node.getAttribute('style') ?? '';
    const { style, blocked } = stripRemoteCssUrls(original);
    if (blocked) {
      node.setAttribute('style', style);
      node.setAttribute(`${REMOTE_ATTR_PREFIX}style`, original);
    }
  }
}

/**
 * Count parked references in a sanitized body, for the "N images blocked"
 * banner. Attribute-based so it needs no extra cache column.
 * @param {string | null | undefined} html
 */
export function countBlockedRemoteRefs(html) {
  const matches = String(html ?? '').match(
    new RegExp(`${REMOTE_ATTR_PREFIX}(?:src|srcset|background|poster|style)=`, 'gi'),
  );
  return matches ? matches.length : 0;
}
