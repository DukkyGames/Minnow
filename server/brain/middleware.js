/**
 * Vite middleware wrapper for /api/brain/* routes.
 */

import { handleBrainRequest } from './routes.js';

export function createBrainMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/brain')) {
      next();
      return;
    }
    const handled = await handleBrainRequest(req, res, url);
    if (!handled) next();
  };
}
