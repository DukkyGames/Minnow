/**
 * Tool client router (SA-5): server detection, execution routing, enabled definitions.
 * Browser tools run in TS; server tools POST to /api/tools when the local server is up.
 */

import { executeBrowserTool } from './browser-executor';
import { executeBoardTool } from './board-tools';
import { executeBugBoardTool } from './bug-board-tools';
import { executeSubAgentTool } from './sub-agent-executor';
import { runCommandWithTerminalStream } from '../ui/terminal-panel';
import {
  ensureToolConfigReady,
  isLocalServerAvailable,
  isToolEnabled,
  loadToolConfig,
  setLocalServerAvailable,
} from './config';
import { blockPlanModeWrite } from '../chat/modes/plan-write-guard';
import { filterToolsByMode } from '../chat/modes/tool-policy';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import type { ToolExecutionResult } from '../types';
import {
  BUILT_IN_TOOLS,
  type OpenAIFunctionDefinition,
  type ToolDefinition,
} from './definitions';
import { enqueueAskQuestion } from './ask-question-queue';
import {
  executeCreateChatWithMode,
  executeProposeModeSwitch,
  executeSetChatMode,
} from './mode-handoff-tools';
import { validateAskQuestionArgs, stringifyAskQuestionResult } from './ask-question-types';
import { maybeBlockToolForUserApproval } from './permission-gate';
import { runWithFileTreeAutoRefresh } from '../ui/file-tree-auto-refresh';
import { executeReportOrchestratorStatus } from '../agents/supervisor/report-tool.ts';
import { recordParentToolResult } from '../agents/supervisor/progress.ts';

/** Ping timeout for local dev server detection (ms). */
const PING_TIMEOUT_MS = 800;

/** Stamp supervisor parent-tool timestamps for orchestrate-mode tools (R4). */
function maybeRecordOrchestrateParentTool(name: string, context: ExecuteToolContext): void {
  if (normalizeModeId(context.modeId) !== 'orchestrate' || !context.chatId?.trim()) return;
  const tracked = new Set([
    'report_orchestrator_status',
    'board_init',
    'board_update_task',
    'board_get_state',
    'spawn_sub_agent',
    'cancel_sub_agent',
    'list_sub_agents',
    'get_sub_agent_status',
  ]);
  if (!tracked.has(name)) return;
  recordParentToolResult(context.chatId.trim());
}

/** Cached MCP tool definitions from GET /api/mcp/tools. */
let cachedMcpToolDefinitions: OpenAIFunctionDefinition[] = [];

/**
 * Probes the dev server tools API with a short timeout and updates availability in config.
 */
export async function detectLocalServer(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  try {
    const response = await fetch('/api/tools/ping', {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      setLocalServerAvailable(false);
      return false;
    }
    const body = (await response.json()) as { ok?: boolean };
    const available = body?.ok === true;
    setLocalServerAvailable(available);
    if (available) {
      await refreshMcpToolCache();
    } else {
      cachedMcpToolDefinitions = [];
    }
    return available;
  } catch {
    setLocalServerAvailable(false);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Whether GET /api/tools/ping succeeded on the last detectLocalServer() call. */
export function getLocalServerAvailable(): boolean {
  return isLocalServerAvailable();
}

/** Optional context for streaming terminal runs and approval UI. */
export interface ExecuteToolContext {
  chatId?: string;
  toolCallId?: string;
  /** Active operating mode for scoped write guards (e.g. Plan → documentation/plans/). */
  modeId?: ModeId | string;
  /** When tools run inside a sub-agent, shown on the approval modal. */
  subAgentType?: string;
}

const STREAMING_TOOL_NAMES = new Set([
  'execute_command',
  'run_javascript',
  'run_python',
]);

/** Plan alias: readable flag after detectLocalServer(). */
export { getLocalServerAvailable as localServerAvailable };

/**
 * Runs a tool by name: browser executor, server POST, or web_search → web_search_ddg fallback.
 */
/** Refresh MCP tool definitions when the local server is available. */
export async function refreshMcpToolCache(): Promise<void> {
  try {
    const response = await fetch('/api/mcp/tools');
    if (!response.ok) {
      cachedMcpToolDefinitions = [];
      return;
    }
    const body = (await response.json()) as { tools?: OpenAIFunctionDefinition[] };
    cachedMcpToolDefinitions = Array.isArray(body.tools) ? body.tools : [];
  } catch {
    cachedMcpToolDefinitions = [];
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown> = {},
  context: ExecuteToolContext = {},
): Promise<ToolExecutionResult> {
  return runWithFileTreeAutoRefresh(name, () => executeToolInner(name, args, context));
}

async function executeToolInner(
  name: string,
  args: Record<string, unknown> = {},
  context: ExecuteToolContext = {},
): Promise<ToolExecutionResult> {
  await ensureToolConfigReady();

  if (name === 'set_chat_mode') {
    if (!isToolEnabled('set_chat_mode')) {
      return {
        content:
          'Error: tool "set_chat_mode" is disabled in Settings (enable it to switch modes from the model).',
      };
    }
    return { content: executeSetChatMode(args) };
  }

  if (name === 'create_chat_with_mode') {
    if (!isToolEnabled('create_chat_with_mode')) {
      return {
        content:
          'Error: tool "create_chat_with_mode" is disabled in Settings (enable it to fork chats by mode).',
      };
    }
    return { content: executeCreateChatWithMode(args) };
  }

  if (name === 'propose_mode_switch') {
    if (!isToolEnabled('propose_mode_switch')) {
      return {
        content:
          'Error: tool "propose_mode_switch" is disabled in Settings (enable it or use ask_question).',
      };
    }
    const content = await executeProposeModeSwitch(args, {
      subAgentType: context.subAgentType,
    });
    return { content };
  }

  if (name === 'ask_question') {
    if (!isToolEnabled('ask_question')) {
      return {
        content:
          'Error: tool "ask_question" is disabled in Settings (set permission to Ask or Full to use it).',
      };
    }
    const parsed = validateAskQuestionArgs(args);
    if (parsed.ok === false) {
      return {
        content: stringifyAskQuestionResult({ status: 'error', message: parsed.error }),
      };
    }
    const content = await enqueueAskQuestion(parsed.args, {
      subAgentType: context.subAgentType,
    });
    return { content };
  }

  if (name.startsWith('mcp__')) {
    if (!isLocalServerAvailable()) {
      return {
        content:
          'Error: MCP tools require the local server. Run `npm start` (not Vite-only dev).',
      };
    }
    const blocked = await maybeBlockToolForUserApproval(name, args, context, name);
    if (blocked) return blocked;
    return executeServerTool(name, args, context.modeId);
  }

  if (
    name === 'spawn_sub_agent' ||
    name === 'cancel_sub_agent' ||
    name === 'list_sub_agents' ||
    name === 'get_sub_agent_status'
  ) {
    const blocked = await maybeBlockToolForUserApproval(name, args, context, name);
    if (blocked) return blocked;
    const text = await executeSubAgentTool(name, args);
    maybeRecordOrchestrateParentTool(name, context);
    return { content: text };
  }

  if (name === 'report_orchestrator_status') {
    const blocked = await maybeBlockToolForUserApproval(name, args, context, name);
    if (blocked) return blocked;
    const text = await executeReportOrchestratorStatus(args, context.chatId);
    maybeRecordOrchestrateParentTool(name, context);
    return { content: text };
  }

  if (
    name === 'board_init' ||
    name === 'board_update_task' ||
    name === 'board_get_state'
  ) {
    const blocked = await maybeBlockToolForUserApproval(name, args, context, name);
    if (blocked) return blocked;
    const text = await executeBoardTool(name, args);
    maybeRecordOrchestrateParentTool(name, context);
    return { content: text };
  }

  if (name === 'bug_add' || name === 'bug_update' || name === 'bug_get_state') {
    const blocked = await maybeBlockToolForUserApproval(name, args, context, name);
    if (blocked) return blocked;
    const text = await executeBugBoardTool(name, args);
    return { content: text };
  }

  const config = loadToolConfig();
  const enrichedArgs = mergeConfigKeysIntoArgs(name, args, config);

  if (name === 'web_search' && !hasBraveApiKey(enrichedArgs, config)) {
    const blocked = await maybeBlockToolForUserApproval(
      'web_search',
      enrichedArgs,
      context,
      'web_search',
    );
    if (blocked) return blocked;
    if (isLocalServerAvailable()) {
      return executeServerTool('web_search_ddg', {
        query: enrichedArgs.query,
      });
    }
    return { content: await executeBrowserTool(name, enrichedArgs) };
  }

  const tool = findToolByFunctionName(name);
  if (!tool) {
    return { content: `Error: unknown tool "${name}"` };
  }

  const permissionId = name === 'web_search_ddg' ? 'web_search' : tool.id;
  const blocked = await maybeBlockToolForUserApproval(
    permissionId,
    enrichedArgs,
    context,
    name,
  );
  if (blocked) return blocked;

  const planWriteBlock = blockPlanModeWrite(context.modeId, name, enrichedArgs);
  if (planWriteBlock) {
    return { content: planWriteBlock };
  }

  if (tool.serverRequired) {
    if (!isLocalServerAvailable()) {
      return {
        content:
          'Error: local tool server is not available. Run `npm start` for file, git, and code tools.',
      };
    }
    if (
      STREAMING_TOOL_NAMES.has(name) &&
      context.chatId &&
      typeof enrichedArgs === 'object'
    ) {
      return {
        content: await executeStreamingCodeTool(name, enrichedArgs, context),
      };
    }
    return executeServerTool(name, enrichedArgs, context.modeId);
  }

  return { content: await executeBrowserTool(name, enrichedArgs) };
}

/** User + server gating only (no mode filter). */
export function getEnabledToolCatalogEntries(): ToolDefinition[] {
  return BUILT_IN_TOOLS.filter((tool) => {
    if (!isToolEnabled(tool.id)) {
      return false;
    }
    if (tool.serverRequired && !isLocalServerAvailable()) {
      return false;
    }
    return true;
  });
}

/**
 * Returns OpenAI function definitions for tools the user enabled and that can run here.
 * Server-required tools are omitted when the local server was not detected.
 */
export function getEnabledToolDefinitions(): OpenAIFunctionDefinition[] {
  return [
    ...getEnabledToolCatalogEntries().map((tool) => tool.definition),
    ...cachedMcpToolDefinitions,
  ];
}

/**
 * Enabled tools after operating mode policy (Step 05).
 */
export function getEnabledToolDefinitionsForMode(
  modeId: ModeId | string | null | undefined,
): OpenAIFunctionDefinition[] {
  const normalized = normalizeModeId(
    typeof modeId === 'string' ? modeId : modeId ?? undefined,
  );
  return filterToolsByMode(getEnabledToolCatalogEntries(), normalized).map(
    (tool) => tool.definition,
  );
}

/** Map code tools to process argv for the terminal runner. */
function mapCodeToolToCommand(
  name: string,
  args: Record<string, unknown>,
): { command: string; argv: string[]; shell?: boolean; label: string } | null {
  if (name === 'execute_command') {
    const command = args.command;
    if (typeof command !== 'string' || !command.trim()) {
      return null;
    }
    const isWin =
      typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent);
    return {
      command: command.trim(),
      argv: [],
      shell: isWin,
      label: command.trim(),
    };
  }
  if (name === 'run_javascript') {
    const code = args.code;
    if (typeof code !== 'string' || !code.trim()) {
      return null;
    }
    return { command: 'node', argv: ['-e', code], label: 'node -e …' };
  }
  if (name === 'run_python') {
    const code = args.code;
    if (typeof code !== 'string' || !code.trim()) {
      return null;
    }
    const isWin =
      typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent);
    const bin = isWin ? 'python' : 'python3';
    return { command: bin, argv: ['-c', code], label: `${bin} -c …` };
  }
  return null;
}

async function executeStreamingCodeTool(
  name: string,
  args: Record<string, unknown>,
  context: ExecuteToolContext,
): Promise<string> {
  const mapped = mapCodeToolToCommand(name, args);
  if (!mapped) {
    return `Error: ${name} requires valid arguments`;
  }

  try {
    return await runCommandWithTerminalStream(mapped.command, {
      chatId: context.chatId!,
      source: 'agent',
      toolCallId: context.toolCallId,
      displayLabel: mapped.label,
      args: mapped.argv,
      shell: mapped.shell,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

/** POST { name, args, modeId? } to the Node tools middleware. */
async function executeServerTool(
  name: string,
  args: Record<string, unknown>,
  modeId?: ModeId | string,
): Promise<ToolExecutionResult> {
  let response: Response;
  const payload: {
    name: string;
    args: Record<string, unknown>;
    modeId?: string;
  } = { name, args };
  if (modeId != null && String(modeId).trim()) {
    payload.modeId = String(modeId).trim();
  }
  try {
    response = await fetch('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error: failed to reach tool server (${message})` };
  }

  let responsePayload: {
    result?: string;
    error?: string;
    attachments?: ToolExecutionResult['attachments'];
  };
  try {
    responsePayload = (await response.json()) as typeof responsePayload;
  } catch {
    return {
      content: `Error: invalid JSON from tool server (HTTP ${response.status})`,
    };
  }

  if (!response.ok) {
    return {
      content: `Error: ${responsePayload.error ?? `tool server HTTP ${response.status}`}`,
    };
  }

  const content = String(responsePayload.result ?? '');
  const attachments = Array.isArray(responsePayload.attachments)
    ? responsePayload.attachments.filter(
        (a): a is NonNullable<ToolExecutionResult['attachments']>[number] =>
          a != null &&
          a.type === 'image' &&
          typeof a.url === 'string' &&
          a.mime === 'image/png',
      )
    : undefined;

  return attachments?.length ? { content, attachments } : { content };
}

/** Resolves catalog entry by OpenAI function name. */
function findToolByFunctionName(name: string): ToolDefinition | undefined {
  return BUILT_IN_TOOLS.find((tool) => tool.definition.function.name === name);
}

/** True when Brave search can run in the browser (arg or saved key). */
function hasBraveApiKey(
  args: Record<string, unknown>,
  config: ReturnType<typeof loadToolConfig>,
): boolean {
  const fromArgs =
    (typeof args.api_key === 'string' && args.api_key.trim()) ||
    (typeof args.braveApiKey === 'string' && args.braveApiKey.trim()) ||
    '';
  const fromConfig = config.keys.braveApiKey?.trim() ?? '';
  return Boolean(fromArgs || fromConfig);
}

/** Injects saved Brave API key into web_search args when the model did not pass one. */
function mergeConfigKeysIntoArgs(
  name: string,
  args: Record<string, unknown>,
  config: ReturnType<typeof loadToolConfig>,
): Record<string, unknown> {
  if (name !== 'web_search') {
    return args;
  }
  if (hasBraveApiKey(args, config)) {
    return args;
  }
  const saved = config.keys.braveApiKey?.trim();
  if (!saved) {
    return args;
  }
  return { ...args, api_key: saved };
}
