/**
 * Tool client router (SA-5): server detection, execution routing, enabled definitions.
 * Browser tools run in TS; server tools POST to /api/tools when the local server is up.
 */

import { executeBrowserTool } from './browser-executor';
import { executeSubAgentTool } from './sub-agent-executor';
import {
  isLocalServerAvailable,
  isToolEnabled,
  loadToolConfig,
  setLocalServerAvailable,
} from './config';
import { filterToolsByMode } from '../chat/modes/tool-policy';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import {
  BUILT_IN_TOOLS,
  type OpenAIFunctionDefinition,
  type ToolDefinition,
} from './definitions';

/** Ping timeout for local dev server detection (ms). */
const PING_TIMEOUT_MS = 800;

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

/** Plan alias: readable flag after detectLocalServer(). */
export { getLocalServerAvailable as localServerAvailable };

/**
 * Runs a tool by name: browser executor, server POST, or web_search → web_search_ddg fallback.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  if (name === 'spawn_sub_agent' || name === 'cancel_sub_agent') {
    return executeSubAgentTool(name, args);
  }

  const config = loadToolConfig();
  const enrichedArgs = mergeConfigKeysIntoArgs(name, args, config);

  if (name === 'web_search' && !hasBraveApiKey(enrichedArgs, config)) {
    if (isLocalServerAvailable()) {
      return executeServerTool('web_search_ddg', {
        query: enrichedArgs.query,
      });
    }
    return executeBrowserTool(name, enrichedArgs);
  }

  const tool = findToolByFunctionName(name);
  if (!tool) {
    return `Error: unknown tool "${name}"`;
  }

  if (tool.serverRequired) {
    if (!isLocalServerAvailable()) {
      return (
        'Error: local tool server is not available. Run `npm start` for file, git, and code tools.'
      );
    }
    return executeServerTool(name, enrichedArgs);
  }

  return executeBrowserTool(name, enrichedArgs);
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
  return getEnabledToolCatalogEntries().map((tool) => tool.definition);
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

/** POST { name, args } to the Node tools middleware. */
async function executeServerTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: failed to reach tool server (${message})`;
  }

  let payload: { result?: string; error?: string };
  try {
    payload = (await response.json()) as { result?: string; error?: string };
  } catch {
    return `Error: invalid JSON from tool server (HTTP ${response.status})`;
  }

  if (!response.ok) {
    return `Error: ${payload.error ?? `tool server HTTP ${response.status}`}`;
  }

  return String(payload.result ?? '');
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
