/**
 * Registers all Minnow Connect middleware in a fixed order (before Vite SPA).
 * Reusable from server.js and a future Electron HTTP host.
 */

import { createAgentPacksMiddleware } from '../agent-packs/routes.js';
import { createChatsWorkspaceMiddleware } from '../chats-workspace/middleware.js';
import { createBenchmarksMiddleware } from '../benchmarks/middleware.js';
import { createBrowserAllowlistMiddleware } from '../browser-allowlist-middleware.js';
import { createBrowserScreenshotMiddleware } from '../browser-screenshot-middleware.js';
import { createConfigMiddleware } from '../config/middleware.js';
import { createEvalsMiddleware } from '../evals/middleware.js';
import { createGenerationsMiddleware } from '../generations/routes.js';
import { createResearchMiddleware } from '../research/routes.js';
import { createLspMiddleware } from '../lsp/middleware.js';
import { createMcpMiddleware } from '../mcp/middleware.js';
import { createServersMiddleware } from '../servers/index.js';
import { createMemoryMiddleware } from '../memory/middleware.js';
import { createPreviewMiddleware } from '../preview/middleware.js';
import { createProfilesMiddleware } from '../profiles/middleware.js';
import { createPromptConfigsMiddleware } from '../prompt-configs/middleware.js';
import { createProviderMiddleware } from '../providers/routes.js';
import { createReefMiddleware } from '../reef/middleware.js';
import { createSkillsMiddleware } from '../skills/middleware.js';
import { createPluginsMiddleware } from '../tools/middleware.js';
import { createTerminalMiddleware } from '../terminal/middleware.js';
import { createSystemMiddleware } from '../system/middleware.js';
import { createWorkspaceMiddleware } from '../workspace/middleware.js';
import { createWorkAgentsMiddleware } from '../work-agents/routes.js';
import { getWorkspaceRoot } from '../workspace/root.js';
import { createToolsMiddleware } from './tools-middleware.js';

/**
 * @param {import('connect').Connect.Server} connectApp
 * @param {{ resolveSafePath: (userPath: string, options?: { write?: boolean }) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 */
export function applyMinnowMiddlewares(connectApp, { resolveSafePath, runWithPathAccess }) {
  connectApp.use(createConfigMiddleware());
  connectApp.use(createBenchmarksMiddleware());
  connectApp.use(createEvalsMiddleware());
  connectApp.use(createWorkspaceMiddleware());
  connectApp.use(createChatsWorkspaceMiddleware());
  connectApp.use(createSystemMiddleware());
  connectApp.use(
    createPreviewMiddleware({
      resolveSafePath,
      runWithPathAccess,
    }),
  );
  connectApp.use(createMemoryMiddleware());
  connectApp.use(createReefMiddleware());
  connectApp.use(createLspMiddleware(() => getWorkspaceRoot()));
  connectApp.use(createMcpMiddleware());
  connectApp.use(createServersMiddleware());
  connectApp.use(createPluginsMiddleware());
  connectApp.use(createPromptConfigsMiddleware());
  connectApp.use(createProfilesMiddleware());
  connectApp.use(createProviderMiddleware());
  connectApp.use(createGenerationsMiddleware());
  connectApp.use(createResearchMiddleware());
  connectApp.use(createWorkAgentsMiddleware());
  connectApp.use(createAgentPacksMiddleware());
  connectApp.use(createBrowserScreenshotMiddleware());
  connectApp.use(createBrowserAllowlistMiddleware());
  connectApp.use(createToolsMiddleware());
  connectApp.use(createSkillsMiddleware());
  connectApp.use(createTerminalMiddleware(() => getWorkspaceRoot()));
}
