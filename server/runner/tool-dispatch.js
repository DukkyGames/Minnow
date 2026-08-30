/**
 * In-process tool dispatch for the shared runner (MIN-701 / P2-D).
 *
 * The renderer POSTs `/api/tools`. A Node runner is already inside the same
 * process as `executeServerTool`, so it must not take that hop — it would
 * serialize every file read through a socket and skip the chance to require
 * an explicit `cwd` (the isolation guarantee).
 *
 * Guards are not optional. This module applies the HTTP-layer checks
 * (`plan-write-guard`, plan-mode `update_settings`, `validateAllowedWorkspaceRoot`,
 * leading-`cd` rewrite) then calls `executeServerTool`, which runs the same
 * handlers as POST `/api/tools` (host-kill, host-port-bind, windows-pipe,
 * output-cap, plugin loader / manifest validate, MCP).
 *
 * Do not import this file from the Vite renderer. Named exports on
 * `server/runner/index.js` exist for Node callers; the renderer adapter keeps
 * `src/tools/headless-tool-batch.ts`.
 */

import { executeServerTool } from '../runtime/tools-middleware.js';
import { validateAllowedWorkspaceRoot } from '../chats-workspace/paths.js';
import {
  blockPlanModeWrite,
  normalizeModeId,
} from '../tools/plan-write-guard.js';
import { guardCdOutsideWorktree } from '../tools/cwd-guard.js';
import { isPluginToolName } from '../tools/loader.js';
import { validatePluginId } from '../tools/validate.js';
import { parsePluginNamespacedName } from '../tools/bridge.js';
import { executeToolCallBatch } from './tool-batch.js';

const PLAN_SETTINGS_BLOCK =
  'Error: Plan mode does not allow update_settings. Use launch_minnow_app to open Settings.';

const CWD_REQUIRED = 'Error: cwd is required';

/**
 * @param {unknown} raw
 * @returns {string}
 */
function requireCwd(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('cwd is required');
  }
  return raw.trim();
}

/**
 * @param {unknown} raw
 * @returns {Set<string> | null}
 */
function normalizeAllowed(raw) {
  if (raw == null) return null;
  if (raw instanceof Set) return raw;
  if (Array.isArray(raw)) return new Set(raw.map(String));
  throw new Error('allowedToolNames must be an array or Set of tool names');
}

/**
 * Plugin manifests are validated by `server/tools/validate.js` at load time.
 * Reject a malformed plugin name here so the in-process route cannot bypass
 * that check the way a raw `executeServerTool` call with a junk name would.
 * @param {string} name
 * @returns {string | null} error content, or null when the name is fine
 */
function pluginNameError(name) {
  if (!isPluginToolName(name)) return null;
  const parsed = parsePluginNamespacedName(name);
  if (!parsed) {
    return `Error: invalid plugin tool name ${name}`;
  }
  try {
    validatePluginId(parsed.pluginId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
  return null;
}

/**
 * HTTP middleware special-cases these before `executeServerTool`. Apply the
 * same checks so a tool cannot behave differently by call route.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {string | undefined} modeId
 * @returns {string | null}
 */
function httpLayerGuardResult(name, args, modeId) {
  const planWriteBlock = blockPlanModeWrite(modeId, name, args);
  if (planWriteBlock) return planWriteBlock;
  const normalized = normalizeModeId(modeId);
  if (normalized === 'plan' && name === 'update_settings') {
    return PLAN_SETTINGS_BLOCK;
  }
  return null;
}

/**
 * Leading absolute `cd` that would leave the attempt root. HTTP applies this
 * when the chat has a worktree; the in-process route always has an explicit
 * `cwd`, so we apply the same rewrite against that root.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {string} cwd
 * @returns {Record<string, unknown>}
 */
function applyCwdGuard(name, args, cwd) {
  if (name !== 'execute_command') return args;
  if (typeof args.command !== 'string') return args;
  const guarded = guardCdOutsideWorktree(args.command, cwd);
  if (!guarded.redirected) return args;
  return { ...args, command: guarded.command };
}

/**
 * Execute one tool against the server registry in-process.
 * `cwd` is required — there is no silent fallback to the Code workspace root.
 *
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @param {{
 *   cwd: string,
 *   modeId?: string | null,
 *   allowedToolNames?: Iterable<string> | Set<string> | null,
 *   toolCallId?: string,
 * }} options
 * @returns {Promise<{ content: string, attachments?: unknown, codeChange?: unknown }>}
 */
export async function executeInProcessTool(name, args = {}, options) {
  if (!options || typeof options !== 'object') {
    return { content: CWD_REQUIRED };
  }

  let cwd;
  try {
    cwd = requireCwd(options.cwd);
  } catch {
    return { content: CWD_REQUIRED };
  }

  if (typeof name !== 'string' || !name.trim()) {
    return { content: 'Error: Missing or invalid "name"' };
  }
  const toolName = name.trim();
  const toolArgs =
    args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};

  const allowed = normalizeAllowed(options.allowedToolNames);
  if (allowed && !allowed.has(toolName)) {
    return { content: `Error: tool "${toolName}" is not in the allowed set` };
  }

  const pluginErr = pluginNameError(toolName);
  if (pluginErr) return { content: pluginErr };

  const modeId =
    typeof options.modeId === 'string' && options.modeId.trim()
      ? options.modeId.trim()
      : undefined;
  const layer = httpLayerGuardResult(toolName, toolArgs, modeId);
  if (layer) return { content: layer };

  let workspaceRoot;
  try {
    workspaceRoot = await validateAllowedWorkspaceRoot(cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${message}` };
  }

  const guardedArgs = applyCwdGuard(toolName, toolArgs, workspaceRoot);
  // execute_command reads chatId from args; forward the attempt id when given
  // so log lines / spawn env can correlate. cwd isolation still comes from
  // workspaceRoot, not from a silent getWorkspaceRoot() default.
  if (
    toolName === 'execute_command' &&
    typeof options.toolCallId === 'string' &&
    options.toolCallId.trim() &&
    typeof guardedArgs.toolCallId !== 'string'
  ) {
    guardedArgs.toolCallId = options.toolCallId.trim();
  }

  const out = await executeServerTool(toolName, guardedArgs, { workspaceRoot });
  /** @type {{ content: string, attachments?: unknown, codeChange?: unknown }} */
  const result = { content: String(out.result ?? '') };
  if (Array.isArray(out.attachments) && out.attachments.length > 0) {
    result.attachments = out.attachments;
  }
  if (out.codeChange && typeof out.codeChange === 'object') {
    result.codeChange = out.codeChange;
  }
  return result;
}

/**
 * Close over attempt `cwd` (and optional allow-list / mode) so `runTurn` can
 * inject `execute` + `runHeadlessToolBatch` without an HTTP hop.
 *
 * @param {{
 *   cwd: string,
 *   modeId?: string | null,
 *   allowedToolNames?: Iterable<string> | Set<string> | null,
 * }} options
 * @returns {{
 *   execute: (name: string, args: unknown, ctx?: { toolCallId?: string }) => Promise<{ content: string }>,
 *   runHeadlessToolBatch: (batchOptions: object) => Promise<object[]>,
 *   cwd: string,
 * }}
 */
export function createInProcessToolDispatch(options) {
  const cwd = requireCwd(options?.cwd);
  const modeId = options?.modeId;
  const allowedToolNames = options?.allowedToolNames ?? null;

  async function execute(name, args, ctx) {
    return executeInProcessTool(
      name,
      args && typeof args === 'object' ? args : {},
      {
        cwd,
        modeId,
        allowedToolNames,
        toolCallId: ctx?.toolCallId,
      },
    );
  }

  async function runHeadlessToolBatch(batchOptions = {}) {
    return executeToolCallBatch({
      toolCalls: batchOptions.toolCalls ?? [],
      constrained: batchOptions.constrained,
      signal: batchOptions.signal,
      execute: batchOptions.execute ?? execute,
      onToolStart: batchOptions.onToolStart,
      onToolDone: batchOptions.onToolDone,
      onParallelSegmentStart: batchOptions.onParallelSegmentStart,
    });
  }

  return { execute, runHeadlessToolBatch, cwd };
}
