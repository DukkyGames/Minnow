/**
 * Vite middleware wrapper for memory API routes.
 */

import { handleMemoryRequest } from './routes.js';

export function createMemoryMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/memory')) {
      next();
      return;
    }
    const handled = await handleMemoryRequest(req, res, url);
    if (!handled) next();
  };
}
