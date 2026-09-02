/**
 * One-shot Minnow server runtime initialization (home layout, workspace, APIs).
 * Callable from server.js or a future Electron HTTP host before listen.
 */

import { ensureAgentPacksLayout } from '../agent-packs/registry.js';
import { ensureBenchmarkWorkspace } from '../benchmark-workspace/paths.js';
import { ensureChatsWorkspace } from '../chats-workspace/paths.js';
import { ensureDesktopWorkspace, initDesktopWorkspacePath } from '../desktop-workspace/paths.js';
import { ensureSchedulerWorkspace } from '../scheduler-workspace/paths.js';
import { ensureMinnowLayout, getMinnowHome } from '../config/home.js';
import { sweepCheckpoints } from '../generations/checkpoint.js';
import { initLspConfig } from '../lsp/middleware.js';
import { initMcpApi } from '../mcp/middleware.js';
import { initServersApi } from '../servers/index.js';
import { initMemoryApi } from '../memory/routes.js';
import { initBrainApi } from '../brain/routes.js';
import { ensureProviderRegistry } from '../providers/store.js';
import { initPluginsApi } from '../tools/middleware.js';
import { initWorkspaceRoot } from '../workspace/root.js';
import { recomputeAllNextRuns } from '../scheduler/store.js';

/**
 * Ensure ~/.minnow layout, load workspace and API registries.
 * Sweep old generation checkpoints so they do not outlive a returning client.
 * @returns {Promise<{ workspacePath: string, homePath: string }>}
 */
export async function bootstrapMinnowRuntime() {
  await ensureMinnowLayout();
  await ensureChatsWorkspace();
  await ensureDesktopWorkspace();
  await initDesktopWorkspacePath();
  await ensureBenchmarkWorkspace();
  await ensureSchedulerWorkspace();
  await ensureAgentPacksLayout();
  const workspacePath = await initWorkspaceRoot();
  await ensureProviderRegistry();
  await initMemoryApi();
  await initBrainApi();
  await initLspConfig();
  await initMcpApi();
  await initServersApi();
  await initPluginsApi();
  await recomputeAllNextRuns();
  sweepCheckpoints();
  const homePath = getMinnowHome();
  return {
    workspacePath,
    homePath,
  };
}
