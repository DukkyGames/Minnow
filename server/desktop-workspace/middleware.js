/**
 * Vite middleware wrapper for desktop workspace API routes.
 */

import { handleDesktopWorkspaceRequest } from './routes.js';

/** Connect middleware factory for /api/desktop-workspace. */
export function createDesktopWorkspaceMiddleware() {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/api/desktop-workspace')) {
      next();
      return;
    }
    const handled = await handleDesktopWorkspaceRequest(
      req,
      res,
      parsed.pathname,
      parsed.searchParams,
    );
    if (!handled) {
      next();
    }
  };
}
