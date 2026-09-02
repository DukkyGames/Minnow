export const REMOTE_ATTR_PREFIX = 'data-minnow-remote-';

const URL_ATTRS = ['src', 'srcset', 'background', 'poster'];

const REMOTE_URL = /^\s*(?:https?:)?\/\//i;

const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/**
 * @param {string | null | undefined} value
 */
function isRemoteUrl(value) {
  return REMOTE_URL.test(String(value ?? ''));
}

/**
 * @param {string} value
 */
function srcsetHasRemote(value) {
  return String(value)
    .split(',')
    .some((candidate) => isRemoteUrl(candidate.trim().split(/\s+/)[0]));
}

/**
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
 * @param {Element} node
 */
export function blockRemoteContentHook(node) {
  if (typeof node.getAttribute !== 'function') return;

  for (const attr of URL_ATTRS) {
    if (!node.hasAttribute(attr)) continue;
    const value = node.getAttribute(attr) ?? '';
    const remote = attr === 'srcset' ? srcsetHasRemote(value) : isRemoteUrl(value);
    if (!remote) continue;
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
 * @param {string | null | undefined} html
 */
export function countBlockedRemoteRefs(html) {
  const matches = String(html ?? '').match(
    new RegExp(`${REMOTE_ATTR_PREFIX}(?:src|srcset|background|poster|style)=`, 'gi'),
  );
  return matches ? matches.length : 0;
}
