import { loadProductWikiCatalog, readProductWikiPage, searchProductWiki } from './catalog.js';

/** Send a JSON response with explicit cache and content-type headers. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** Handle read-only product-wiki requests. */
export async function handleProductWikiRequest(req, res) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (requestUrl.pathname === '/api/product-wiki/catalog' && req.method === 'GET') {
    sendJson(res, 200, await loadProductWikiCatalog());
    return true;
  }
  if (requestUrl.pathname === '/api/product-wiki/page' && req.method === 'GET') {
    const page = await readProductWikiPage(requestUrl.searchParams.get('path'));
    sendJson(res, 200, page);
    return true;
  }
  if (requestUrl.pathname === '/api/product-wiki/search' && req.method === 'GET') {
    const hits = await searchProductWiki(requestUrl.searchParams.get('q'), {
      limit: requestUrl.searchParams.get('limit'),
      section: requestUrl.searchParams.get('section') || undefined,
    });
    sendJson(res, 200, { hits });
    return true;
  }
  return false;
}

/** Create Connect middleware for the official read-only documentation API. */
export function createProductWikiMiddleware() {
  return async (req, res, next) => {
    const pathname = req.url?.split('?')[0] ?? '';
    if (!pathname.startsWith('/api/product-wiki')) {
      next();
      return;
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const handled = await handleProductWikiRequest(req, res);
      if (!handled) sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { error: message });
    }
  };
}
