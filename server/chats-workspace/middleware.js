/**
 * Vite middleware wrapper for chats workspace API routes.
 */

import { handleChatsWorkspaceRequest } from './routes.js';

/** Connect middleware factory for /api/chats-workspace. */
export function createChatsWorkspaceMiddleware() {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/api/chats-workspace')) {
      next();
      return;
    }
    const handled = await handleChatsWorkspaceRequest(
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
