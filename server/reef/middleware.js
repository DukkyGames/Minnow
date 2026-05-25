/**
 * Vite middleware wrapper for reef artifact API routes.
 */

import { handleReefRequest } from './routes.js';

export function createReefMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/reef')) {
      next();
      return;
    }
    const handled = await handleReefRequest(req, res, url);
    if (!handled) next();
  };
}
