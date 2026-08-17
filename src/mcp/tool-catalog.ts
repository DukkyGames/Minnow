/**
 * Per-server MCP tool listings for Settings → Tools (GET /api/mcp/tools/catalog).
 * Kept free of app imports so settings UI can load it without the tool client.
 */

/** One tool as exposed to permissions. */
export type McpCatalogTool = {
  /** The server's own spelling, e.g. `browser_navigate`. */
  name: string;
  /** Permission id and dispatch key, e.g. `mcp__playwright__browser_navigate`. */
  namespacedName: string;
  description: string;
};

/** One enabled server and its live tool listing (`error` when it never started). */
export type McpToolCatalogEntry = {
  id: string;
  label: string;
  error: string | null;
  tools: McpCatalogTool[];
};

/** Load per-server MCP tool listings; empty when the local server is unavailable. */
export async function fetchMcpToolCatalog(): Promise<McpToolCatalogEntry[]> {
  try {
    const res = await fetch('/api/mcp/tools/catalog');
    if (!res.ok) return [];
    const body = (await res.json()) as { servers?: McpToolCatalogEntry[] };
    return Array.isArray(body.servers) ? body.servers : [];
  } catch {
    return [];
  }
}
