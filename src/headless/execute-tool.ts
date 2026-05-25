/**
 * Headless tool execution — server POST only; block browser/UI tools with clear errors.
 */

import { blockPlanModeWrite } from '../chat/modes/plan-write-guard';
import { isToolAllowedForMode, filterToolsByMode } from '../chat/modes/tool-policy';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import {
  ensureToolConfigReady,
  isToolEnabled,
  loadToolConfig,
} from '../tools/config';
import {
  BUILT_IN_TOOLS,
  type OpenAIFunctionDefinition,
  type ToolDefinition,
} from '../tools/definitions';
import type { ExecuteToolContext } from '../tools/client';
import type { ToolExecutionResult } from '../types';
import {
  maybeBlockHeadlessToolApproval,
  type HeadlessApprovalOptions,
} from './approval';
import { headlessApiUrl } from './server-context';

const BROWSER_ONLY_TOOLS = new Set([
  'get_datetime',
  'calculate',
  'ask_question',
  'propose_mode_switch',
  'set_chat_mode',
  'create_chat_with_mode',
  'spawn_sub_agent',
  'cancel_sub_agent',
  'list_sub_agents',
  'get_sub_agent_status',
  'report_orchestrator_status',
  'board_init',
  'board_update_task',
  'board_get_state',
  'check_reef_widget',
  'request_browser_origin_access',
]);

const UI_BROWSER_PREFIXES = ['browser_'];

function isBrowserOnlyTool(name: string): boolean {
  if (BROWSER_ONLY_TOOLS.has(name)) return true;
  if (name.startsWith('mcp__') || name.startsWith('plugin__')) return false;
  return UI_BROWSER_PREFIXES.some((p) => name.startsWith(p));
}

/** Tools exposed to the model in headless mode (server-capable + policy). */
export function getHeadlessToolDefinitions(modeId: ModeId): OpenAIFunctionDefinition[] {
  const catalog = BUILT_IN_TOOLS.filter((tool) => {
    if (!isToolEnabled(tool.id)) return false;
    if (!tool.serverRequired && isBrowserOnlyTool(tool.definition.function.name)) {
      return false;
    }
    if (!tool.serverRequired) return false;
    return true;
  });
  return filterToolsByMode(catalog, modeId).map((t) => t.definition);
}

async function postServerTool(
  name: string,
  args: Record<string, unknown>,
  modeId: ModeId,
): Promise<ToolExecutionResult> {
  const payload: { name: string; args: Record<string, unknown>; modeId?: string } = {
    name,
    args,
  };
  payload.modeId = modeId;
  let response: Response;
  try {
    response = await fetch(headlessApiUrl('/api/tools'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error: failed to reach tool server (${message})` };
  }

  let body: { result?: string; error?: string };
  try {
    body = (await response.json()) as { result?: string; error?: string };
  } catch {
    return { content: `Error: invalid tool response (HTTP ${response.status})` };
  }
  if (!response.ok) {
    return { content: body.error ?? `Error: tool HTTP ${response.status}` };
  }
  return { content: body.result ?? '' };
}

export interface HeadlessExecuteToolOptions extends HeadlessApprovalOptions {
  modeId: ModeId;
  autoRejectQuestions: boolean;
}

/**
 * Execute one tool in headless context (approval gate + server POST).
 */
export async function executeHeadlessTool(
  name: string,
  args: Record<string, unknown> = {},
  context: ExecuteToolContext = {},
  options: HeadlessExecuteToolOptions,
): Promise<ToolExecutionResult> {
  await ensureToolConfigReady();

  const modeId = normalizeModeId(options.modeId);
  if (!isToolAllowedForMode(modeId, name)) {
    return {
      content: `Error: tool "${name}" is not allowed in mode "${modeId}"`,
    };
  }

  const tool = BUILT_IN_TOOLS.find((t) => t.definition.function.name === name) as
    | ToolDefinition
    | undefined;

  if (name === 'ask_question') {
    if (options.autoRejectQuestions) {
      return {
        content:
          'Error: ask_question is not available in non-interactive headless mode. Proceed without user input or split the task.',
      };
    }
  }

  if (isBrowserOnlyTool(name) && (!tool || !tool.serverRequired)) {
    return {
      content: `Error: tool "${name}" requires the Minnow browser UI and cannot run in headless mode.`,
    };
  }

  const permissionId = name === 'web_search_ddg' ? 'web_search' : (tool?.id ?? name);
  const blocked = maybeBlockHeadlessToolApproval(
    permissionId,
    args,
    { ...context, modeId },
    options,
    name,
  );
  if (blocked) return blocked;

  const planWriteBlock = blockPlanModeWrite(modeId, name, args);
  if (planWriteBlock) {
    return { content: planWriteBlock };
  }

  if (!tool?.serverRequired) {
    return {
      content: `Error: tool "${name}" is not available via the headless server API.`,
    };
  }

  return postServerTool(name, args, modeId);
}
