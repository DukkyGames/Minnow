/**
 * Settings → Tools: permission rows for the tools each connected MCP server
 * exposes, one collapsible group per server.
 */

import { fetchMcpToolCatalog, type McpToolCatalogEntry } from '../mcp/tool-catalog';
import { isToolPermissionMode, loadToolConfig } from '../tools/config';
import { bindToolsListChange, createDynamicToolGroup } from './tools-list';

/** Test fixture server — hidden here as it is in the MCP servers list. */
const MCP_TOOLS_HIDDEN_IDS = new Set(['fixture']);

const GROUP_PREFIX = 'mcp:';

/** Descriptions longer than this get the full text on hover. */
const CLAMP_HINT_CHARS = 160;

function createPermissionSelect(toolLabel: string, mode: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'tool-permission-select';
  select.setAttribute('aria-label', `${toolLabel} permission`);
  for (const optDef of [
    { value: 'off', label: 'Disabled' },
    { value: 'ask', label: 'Requires permission' },
    { value: 'full', label: 'Full permission' },
  ] as const) {
    const opt = document.createElement('option');
    opt.value = optDef.value;
    opt.textContent = optDef.label;
    select.appendChild(opt);
  }
  // Unlisted MCP ids resolve to `ask` at call time; show the same default here.
  select.value = isToolPermissionMode(mode) ? mode : 'ask';
  return select;
}

function createMcpToolRow(
  tool: McpToolCatalogEntry['tools'][number],
  storedMode: unknown,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tool-row tool-row--mcp';
  row.setAttribute('data-tool-id', tool.namespacedName);
  row.setAttribute('data-server-required', '');
  row.dataset.settingsSearchKey = `tools.item.${tool.namespacedName}`;

  const controlWrap = document.createElement('div');
  controlWrap.className = 'tool-permission-wrap';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tool-label tool-label--code';
  nameSpan.textContent = tool.name;

  controlWrap.append(
    nameSpan,
    createPermissionSelect(tool.name, String(storedMode ?? '')),
  );
  row.appendChild(controlWrap);

  if (tool.description) {
    const desc = document.createElement('p');
    // MCP descriptions are written for the model and run to hundreds of words;
    // the row clamps them (see settings.css) and keeps the rest on hover.
    desc.className = 'tool-desc tool-desc--clamped';
    desc.textContent = tool.description;
    if (tool.description.length > CLAMP_HINT_CHARS) {
      desc.title = tool.description;
    }
    row.appendChild(desc);
  }

  return row;
}

/** Why a server contributes no rows, phrased so the fix is obvious. */
function createServerNotice(entry: McpToolCatalogEntry): HTMLElement {
  const hint = document.createElement('p');
  hint.className = 'tool-group-hint';
  hint.textContent = entry.error
    ? `Could not start this server: ${entry.error}. Check its command in Integrations → MCP servers.`
    : 'Connected, but the server listed no tools.';
  return hint;
}

/**
 * Append one group per enabled MCP server to a tools list container.
 * Replaces any groups from a previous render.
 */
export async function appendMcpToolsToList(listId: string): Promise<void> {
  const container = document.getElementById(listId);
  if (!container) return;

  const catalog = await fetchMcpToolCatalog();

  for (const stale of container.querySelectorAll(
    `[data-tool-category^="${GROUP_PREFIX}"]`,
  )) {
    stale.remove();
  }

  const servers = catalog.filter((entry) => !MCP_TOOLS_HIDDEN_IDS.has(entry.id));
  if (servers.length === 0) return;

  const collapsible = container.classList.contains('tools-list--settings');
  const config = loadToolConfig();

  for (const entry of servers) {
    const bodyNodes: HTMLElement[] = [];
    if (entry.tools.length === 0) {
      bodyNodes.push(createServerNotice(entry));
    }
    for (const tool of entry.tools) {
      bodyNodes.push(
        createMcpToolRow(tool, config.permissions.default[tool.namespacedName]),
      );
    }

    const count = entry.error
      ? 'Not connected'
      : `${entry.tools.length} tool${entry.tools.length === 1 ? '' : 's'}`;

    container.appendChild(
      createDynamicToolGroup({
        category: `${GROUP_PREFIX}${entry.id}`,
        title: entry.label,
        count,
        searchKey: `tools.category.mcp.${entry.id}`,
        collapsible,
        bodyNodes,
      }),
    );
  }

  bindToolsListChange(container);
}
