/**
 * Serves SPA navigations with the host token only to loopback requests.
 * LAN companions receive the same shell without the privileged credential.
 */

import fs from 'node:fs/promises';
import { isHostAllowed } from '../network/access.js';
import { getSessionToken, injectSessionTokenScript } from './session-token.js';

/** Whether a GET/HEAD request should receive the SPA navigation shell. */
export function isHtmlNavigationRequest(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const accept = req.headers.accept ?? '';
  return accept.includes('text/html');
}

/** Inject the host credential only when the request Host is loopback. */
export function addRequestAuthToHtml(html, hostHeader) {
  if (!isHostAllowed(hostHeader ?? '', 'local')) return html;
  return injectSessionTokenScript(html, getSessionToken());
}

/**
 * Build a navigation middleware shared by Vite and packaged Electron.
 * Vite supplies transformHtml so its normal HTML plugins still run.
 */
export function createSpaAuthHtmlMiddleware({ indexPath, transformHtml = async (_url, html) => html }) {
  return async function spaAuthHtmlMiddleware(req, res, next) {
    if (!isHtmlNavigationRequest(req)) {
      next();
      return;
    }

    try {
      const source = await fs.readFile(indexPath, 'utf8');
      const transformed = await transformHtml(req.originalUrl ?? req.url ?? '/', source);
      const html = addRequestAuthToHtml(transformed, req.headers.host);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : html);
    } catch (error) {
      next(error);
    }
  };
}

