/**
 * Vite middleware wrapper for benchmark workspace API routes.
 */

import { handleBenchmarkWorkspaceRequest } from './routes.js';

/** Connect middleware factory for /api/benchmark-workspace. */
export function createBenchmarkWorkspaceMiddleware() {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/api/benchmark-workspace')) {
      next();
      return;
    }
    const handled = await handleBenchmarkWorkspaceRequest(req, res, parsed.pathname);
    if (!handled) {
      next();
    }
  };
}
