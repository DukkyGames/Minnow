/**
 * web_search provider routing — respects user-selected provider without silent fallback.
 */

import type { ToolConfig, WebSearchProvider } from './tool-settings-types';

export type WebSearchExecution =
  | { kind: 'brave' }
  | { kind: 'tavily' }
  | { kind: 'ddg' }
  | { kind: 'error'; message: string };

/** Normalize persisted provider; unknown values fall back to DuckDuckGo. */
export function normalizeWebSearchProvider(value: unknown): WebSearchProvider {
  if (value === 'brave' || value === 'tavily' || value === 'duckduckgo') {
    return value;
  }
  return 'duckduckgo';
}

/** True when Brave search can run (arg or saved key). */
export function hasBraveApiKey(
  args: Record<string, unknown>,
  config: ToolConfig,
): boolean {
  const fromArgs =
    (typeof args.api_key === 'string' && args.api_key.trim()) ||
    (typeof args.braveApiKey === 'string' && args.braveApiKey.trim()) ||
    '';
  const fromConfig = config.keys.braveApiKey?.trim() ?? '';
  return Boolean(fromArgs || fromConfig);
}

/** True when a Tavily API key is available in tool config. */
export function hasTavilyApiKey(config: ToolConfig): boolean {
  return Boolean(config.keys.tavilyApiKey?.trim());
}

/**
 * Resolve how `web_search` should run for the current settings.
 * Does not silently fall back when the selected provider cannot run.
 */
export function resolveWebSearchExecution(
  config: ToolConfig,
  args: Record<string, unknown>,
  serverAvailable: boolean,
): WebSearchExecution {
  const provider = normalizeWebSearchProvider(config.webSearchProvider);

  if (provider === 'brave') {
    if (!hasBraveApiKey(args, config)) {
      return {
        kind: 'error',
        message:
          'Error: Brave is selected as the web search provider but no Brave Search API key is configured. Add one in Settings → Tools.',
      };
    }
    return { kind: 'brave' };
  }

  if (provider === 'tavily') {
    if (!hasTavilyApiKey(config)) {
      return {
        kind: 'error',
        message:
          'Error: Tavily is selected as the web search provider but no Tavily API key is configured. Add one in Settings → Tools.',
      };
    }
    if (!serverAvailable) {
      return {
        kind: 'error',
        message:
          'Error: Tavily web search requires the local tool server. Run npm start (not npm run dev).',
      };
    }
    return { kind: 'tavily' };
  }

  if (!serverAvailable) {
    return {
      kind: 'error',
      message:
        'Error: DuckDuckGo web search requires the local tool server. Run npm start (not npm run dev).',
    };
  }
  return { kind: 'ddg' };
}
