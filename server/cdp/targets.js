/**
 * List Chrome DevTools page targets via HTTP /json/list.
 * Ported from opencode-browser (MIT).
 */

/**
 * @typedef {object} BrowserTarget
 * @property {string} id
 * @property {string} type
 * @property {string} title
 * @property {string} url
 * @property {string} webSocketDebuggerUrl
 */

/**
 * Fetch targets and rewrite WebSocket URLs when browser_url is a remote proxy.
 * @param {string} browserUrl
 * @returns {Promise<BrowserTarget[]>}
 */
export async function listTargets(browserUrl) {
  const url = browserUrl.replace(/\/$/, '');
  const res = await fetch(`${url}/json/list`);
  if (!res.ok) {
    throw new Error(`Failed to list targets: ${res.status}`);
  }
  const targets = /** @type {BrowserTarget[]} */ (await res.json());

  const parsed = new URL(url);
  const isProxy = !['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
  if (isProxy) {
    const wsScheme = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    for (const target of targets) {
      if (target.webSocketDebuggerUrl) {
        const wsPath = new URL(target.webSocketDebuggerUrl).pathname;
        target.webSocketDebuggerUrl = `${wsScheme}//${parsed.host}${wsPath}`;
      }
    }
  }

  return targets;
}

/**
 * @param {BrowserTarget[]} targets
 * @param {string} [targetId]
 * @returns {BrowserTarget | undefined}
 */
export function findPageTarget(targets, targetId) {
  const pages = targets.filter((t) => t.type === 'page');
  if (targetId) {
    return pages.find((t) => t.id === targetId);
  }
  return pages[0];
}
