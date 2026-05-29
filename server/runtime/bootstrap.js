/**
 * One-shot Minnow server runtime initialization (home layout, workspace, APIs).
 * Callable from server.js or a future Electron HTTP host before listen.
 */

import { ensureAgentPacksLayout } from '../agent-packs/registry.js';
import { ensureMinnowLayout, getMinnowHome } from '../config/home.js';
import { initLspConfig } from '../lsp/middleware.js';
import { initMcpApi } from '../mcp/middleware.js';
import { initMemoryApi } from '../memory/routes.js';
import { ensureProviderRegistry } from '../providers/store.js';
import { syncReefWidgetTemplates } from '../reef/sync-widgets.js';
import { initPluginsApi } from '../tools/middleware.js';
import { initWorkspaceRoot } from '../workspace/root.js';

/**
 * Ensure ~/.minnow layout, sync Reef widgets, load workspace and API registries.
 * @returns {Promise<{ workspacePath: string, homePath: string, reefSyncCount: number }>}
 */
export async function bootstrapMinnowRuntime() {
  await ensureMinnowLayout();
  await ensureAgentPacksLayout();
  const reefSync = await syncReefWidgetTemplates();
  const workspacePath = await initWorkspaceRoot();
  await ensureProviderRegistry();
  await initMemoryApi();
  await initLspConfig();
  await initMcpApi();
  await initPluginsApi();
  const homePath = getMinnowHome();
  return {
    workspacePath,
    homePath,
    reefSyncCount: reefSync.copied,
  };
}
