import { loadProductWikiCatalog, readProductWikiPage, searchProductWiki } from '../product-wiki/catalog.js';

/** Search shipped Minnow documentation and return citation-ready ranked hits. */
export async function toolMinnowDocsSearch(args) {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) return 'Error: query is required.';
  try {
    const hits = await searchProductWiki(query, {
      limit: args?.limit,
      section: typeof args?.section === 'string' ? args.section.trim() : undefined,
    });
    return JSON.stringify({ query, hits }, null, 2);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Read one shipped Minnow documentation page by its catalog path. */
export async function toolMinnowDocsRead(args) {
  const requestedPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!requestedPath) return 'Error: path is required.';
  try {
    const page = await readProductWikiPage(requestedPath);
    return `Source: ${page.path}\nTitle: ${page.title}\n\n${page.content}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** List official documentation metadata without reading full page bodies. */
export async function toolMinnowDocsList(args) {
  const prefix = typeof args?.prefix === 'string' ? args.prefix.trim() : '';
  try {
    const catalog = await loadProductWikiCatalog();
    const entries = prefix
      ? catalog.entries.filter((entry) => entry.path.startsWith(prefix))
      : catalog.entries;
    return JSON.stringify({ entries }, null, 2);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
