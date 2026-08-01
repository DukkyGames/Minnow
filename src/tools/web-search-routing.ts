/**
 * web_search provider routing — respects search.json (then tools.json) without silent fallback.
 */

import type { ToolConfig, WebSearchProvider } from './tool-settings-types';
import { mergeWebSearchSettings } from '../config/search-config';

export type WebSearchExecution =
  | { kind: 'brave' }
  | { kind: 'tavily' }
  | { kind: 'ddg' }
  | { kind: 'searxng' }
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
  keys: { braveApiKey?: string },
): boolean {
  const fromArgs =
    (typeof args.api_key === 'string' && args.api_key.trim()) ||
    (typeof args.braveApiKey === 'string' && args.braveApiKey.trim()) ||
    '';
  const fromConfig = keys.braveApiKey?.trim() ?? '';
  return Boolean(fromArgs || fromConfig);
}

/** True when a Tavily API key is available. */
export function hasTavilyApiKey(keys: { tavilyApiKey?: string }): boolean {
  return Boolean(keys.tavilyApiKey?.trim());
}

/**
 * Resolve how `web_search` should run for the current settings.
 * Prefers search.json via {@link mergeWebSearchSettings}; tools.json is the fallback.
 */
export function resolveWebSearchExecution(
  toolsConfig: ToolConfig,
  args: Record<string, unknown>,
  serverAvailable: boolean,
  searchConfig?: Parameters<typeof mergeWebSearchSettings>[0],
): WebSearchExecution {
  const effective = mergeWebSearchSettings(searchConfig, toolsConfig);
  const provider = effective.provider;

  if (provider === 'disabled') {
    return {
      kind: 'error',
      message:
        'Error: Web search is disabled. Enable a provider in Settings → Search.',
    };
  }

  if (provider === 'searxng') {
    if (!serverAvailable) {
      return {
        kind: 'error',
        message:
          'Error: SearXNG web search needs Minnow running locally. Open or restart the app.',
      };
    }
    return { kind: 'searxng' };
  }

  const legacy = normalizeWebSearchProvider(provider);

  if (legacy === 'brave') {
    if (!hasBraveApiKey(args, effective.keys)) {
      return {
        kind: 'error',
        message:
          'Error: Brave is selected as the web search provider but no Brave Search API key is configured. Add one in Settings → Search.',
      };
    }
    return { kind: 'brave' };
  }

  if (legacy === 'tavily') {
    if (!hasTavilyApiKey(effective.keys)) {
      return {
        kind: 'error',
        message:
          'Error: Tavily is selected as the web search provider but no Tavily API key is configured. Add one in Settings → Search.',
      };
    }
    if (!serverAvailable) {
      return {
        kind: 'error',
        message:
          'Error: Tavily web search needs Minnow running locally. Open or restart the app.',
      };
    }
    return { kind: 'tavily' };
  }

  if (!serverAvailable) {
    return {
      kind: 'error',
      message:
        'Error: DuckDuckGo web search needs Minnow running locally. Open or restart the app.',
    };
  }
  return { kind: 'ddg' };
}
