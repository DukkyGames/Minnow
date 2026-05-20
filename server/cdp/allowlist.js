/**
 * Navigation allowlist: glob-like origin patterns for browser_navigate.
 */

/**
 * Convert a simple glob pattern to a RegExp (supports * for any chars).
 * @param {string} pattern e.g. "http://localhost:*"
 */
function patternToRegExp(pattern) {
  let re = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      re += '.*';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re, 'i');
}

/**
 * @param {string} url
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function isNavigationAllowed(url, patterns) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const originKey = `${parsed.protocol}//${parsed.host}`;
  for (const pattern of patterns) {
    if (!pattern || typeof pattern !== 'string') continue;
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    if (patternToRegExp(trimmed).test(originKey) || patternToRegExp(trimmed).test(url)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} url
 * @param {string[]} patterns
 */
export function assertNavigationAllowed(url, patterns) {
  if (!isNavigationAllowed(url, patterns)) {
    throw new Error(`navigation blocked by allowlist: ${url}`);
  }
}
