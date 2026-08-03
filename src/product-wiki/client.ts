export interface ProductWikiEntry {
  path: string;
  title: string;
  summary: string;
  headings: string[];
  section: string;
  hash: string;
}

export interface ProductWikiPage extends ProductWikiEntry {
  content: string;
}

export interface ProductWikiSearchHit extends Omit<ProductWikiEntry, 'hash'> {
  excerpt: string;
  score: number;
}

/** Fetch JSON while preserving a useful server error for the reader state. */
async function wikiFetch<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `Wiki request failed (${response.status}).`);
  }
  return body;
}

/** Load navigation metadata for every official wiki page. */
export async function fetchProductWikiCatalog(): Promise<ProductWikiEntry[]> {
  const catalog = await wikiFetch<{ entries: ProductWikiEntry[] }>('/api/product-wiki/catalog');
  return catalog.entries;
}

/** Load one official Markdown page. */
export function fetchProductWikiPage(path: string): Promise<ProductWikiPage> {
  const query = new URLSearchParams({ path });
  return wikiFetch<ProductWikiPage>(`/api/product-wiki/page?${query}`);
}

/** Search official docs by title, heading, path, and body. */
export async function searchProductWiki(query: string, limit = 12): Promise<ProductWikiSearchHit[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const result = await wikiFetch<{ hits: ProductWikiSearchHit[] }>(
    `/api/product-wiki/search?${params}`,
  );
  return result.hits;
}
