/**
 * Registers all Minnow Connect middleware in a fixed order (before Vite SPA).
 * Reusable from server.js and a future Electron HTTP host.
 */

import { createAgentPacksMiddleware } from '../agent-packs/routes.js';
import { createBenchmarkWorkspaceMiddleware } from '../benchmark-workspace/middleware.js';
import { createChatsWorkspaceMiddleware } from '../chats-workspace/middleware.js';
import { createDesktopWorkspaceMiddleware } from '../desktop-workspace/middleware.js';
import { createBenchmarksMiddleware } from '../benchmarks/middleware.js';
import { createCompareMiddleware } from '../compare/middleware.js';
import { createBrowserAllowlistMiddleware } from '../browser-allowlist-middleware.js';
import { createBrowserScreenshotMiddleware } from '../browser-screenshot-middleware.js';
import { createSettingsMiddleware } from '../settings/middleware.js';
import { createConfigMiddleware } from '../config/middleware.js';
import { createEvalsMiddleware } from '../evals/middleware.js';
import { createGenerationsMiddleware } from '../generations/routes.js';
import { createResearchMiddleware } from '../research/routes.js';
import { createLspMiddleware } from '../lsp/middleware.js';
import { createMcpMiddleware } from '../mcp/middleware.js';
import { createServersMiddleware } from '../servers/index.js';
import { createMemoryMiddleware } from '../memory/middleware.js';
import { createBrainMiddleware } from '../brain/middleware.js';
import { createProductWikiMiddleware } from '../product-wiki/middleware.js';
import { createPreviewMiddleware } from '../preview/middleware.js';
import { createDesignAnnotationsMiddleware } from '../design/annotations-routes.js';
import { createSourceMapMiddleware } from '../design/source-map-routes.js';
import { createProfilesMiddleware } from '../profiles/middleware.js';
import { createPromptConfigsMiddleware } from '../prompt-configs/middleware.js';
import { createProviderMiddleware } from '../providers/routes.js';
import { createSttMiddleware } from '../stt/middleware.js';
import { createTtsMiddleware } from '../tts/middleware.js';
import { createVoiceRuntimeMiddleware } from '../voice/routes.js';
import { createSkillsMiddleware } from '../skills/middleware.js';
import { createPluginsMiddleware } from '../tools/middleware.js';
import { createTerminalMiddleware } from '../terminal/middleware.js';
import { createSystemMiddleware } from '../system/middleware.js';
import { createModelsMiddleware } from '../models/index.js';
import { createSchedulerMiddleware } from '../scheduler/middleware.js';
import { createCalendarMiddleware } from '../calendar/middleware.js';
import { createEmailMiddleware } from '../email/middleware.js';
import { createWebhooksMiddleware } from '../webhooks/middleware.js';
import { createWorkspaceMiddleware } from '../workspace/middleware.js';
import { createGitMiddleware } from '../git/middleware.js';
import { createWorktreeMiddleware } from '../worktree/middleware.js';
import { createWorkAgentsMiddleware } from '../work-agents/routes.js';
import { createOrchestrateMiddleware } from '../orchestrate/middleware.js';
import { createBoardTestingMiddleware } from '../orchestrate/board-testing/middleware.js';
import { getWorkspaceRoot } from '../workspace/root.js';
import { createToolsMiddleware } from './tools-middleware.js';
import { createAuthMiddleware } from './auth-middleware.js';
import { createAuthRoutesMiddleware } from '../auth/routes.js';
import { createDiagnosticsMiddleware } from '../diagnostics/middleware.js';
import { installDiagnosticsProcessHandlers } from '../diagnostics/process-handlers.js';

/**
 * @param {import('connect').Connect.Server} connectApp
 * @param {{ resolveSafePath: (userPath: string, options?: { write?: boolean }) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 */
export function applyMinnowMiddlewares(connectApp, { resolveSafePath, runWithPathAccess }) {
  installDiagnosticsProcessHandlers();
  connectApp.use(createAuthMiddleware());
  connectApp.use(createAuthRoutesMiddleware());
  connectApp.use(createDiagnosticsMiddleware());
  connectApp.use(createConfigMiddleware());
  connectApp.use(createSettingsMiddleware());
  connectApp.use(createBenchmarksMiddleware());
  connectApp.use(createCompareMiddleware());
  connectApp.use(createEvalsMiddleware());
  connectApp.use(createWorkspaceMiddleware());
  connectApp.use(createGitMiddleware());
  connectApp.use(createWorktreeMiddleware());
  connectApp.use(createOrchestrateMiddleware());
  connectApp.use(createBoardTestingMiddleware());
  connectApp.use(createChatsWorkspaceMiddleware());
  connectApp.use(createDesktopWorkspaceMiddleware());
  connectApp.use(createBenchmarkWorkspaceMiddleware());
  connectApp.use(createSystemMiddleware());
  connectApp.use(createModelsMiddleware());
  connectApp.use(createSchedulerMiddleware());
  connectApp.use(createCalendarMiddleware());
  connectApp.use(createEmailMiddleware());
  connectApp.use(
    createPreviewMiddleware({
      resolveSafePath,
      runWithPathAccess,
    }),
  );
  connectApp.use(
    createDesignAnnotationsMiddleware({
      resolveSafePath,
      runWithPathAccess,
    }),
  );
  connectApp.use(
    createSourceMapMiddleware({
      resolveSafePath,
      runWithPathAccess,
    }),
  );
  connectApp.use(createMemoryMiddleware());
  connectApp.use(createBrainMiddleware());
  connectApp.use(createProductWikiMiddleware());
  connectApp.use(createWebhooksMiddleware());
  connectApp.use(createLspMiddleware(() => getWorkspaceRoot()));
  connectApp.use(createMcpMiddleware());
  connectApp.use(createServersMiddleware());
  connectApp.use(createPluginsMiddleware());
  connectApp.use(createPromptConfigsMiddleware());
  connectApp.use(createProfilesMiddleware());
  connectApp.use(createProviderMiddleware());
  connectApp.use(createSttMiddleware());
  connectApp.use(createTtsMiddleware());
  connectApp.use(createVoiceRuntimeMiddleware());
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
