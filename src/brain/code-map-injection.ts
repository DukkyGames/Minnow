/**
 * Fetch token-budgeted repo map text for system prompt injection.
 */

import { brainWorkspaceKeyFromPath } from '../lib/brain-workspace-key';
import { wrapUntrusted } from '../lib/untrusted.mjs';
import { fetchBrainCodeConfig, fetchBrainCodeRepoMap } from './client';

export interface RetrieveCodeMapBlockOptions {
  /** Absolute workspace or worktree root for repo key resolution. */
  repoPath: string;
  focus?: string;
  tokenBudget?: number;
  ensureIndexed?: boolean;
}

/** Ranked repo map wrapped for untrusted prompt injection; empty when unavailable. */
export async function retrieveCodeMapBlock(
  options: RetrieveCodeMapBlockOptions,
): Promise<string> {
  const config = await fetchBrainCodeConfig();
  if (!config?.enabled) return '';

  const repoPath = options.repoPath.trim();
  if (!repoPath) return '';

  const repo = brainWorkspaceKeyFromPath(repoPath);
  const map = await fetchBrainCodeRepoMap({
    repo,
    focus: options.focus,
    tokenBudget: options.tokenBudget ?? config.repoMapTokenBudget,
    ensureIndexed: options.ensureIndexed !== false,
  });

  const text = map?.text?.trim() ?? '';
  if (!text) return '';
  return wrapUntrusted(text, { source: 'code-map' });
}
