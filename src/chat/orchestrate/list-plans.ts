/**
 * Discover markdown plans under documentation/plans/ for Orchestrate mode (server tools).
 */

import { executeTool } from '../../tools/client';
import { isLocalServerAvailable } from '../../tools/config';
import { isExecutableOrchestratePlan } from './plan-path';

export interface DiscoverOrchestratePlansResult {
  plans: string[];
  /** Present when listing failed or server is unavailable (UI maps to hints). */
  error?: 'server_off' | string;
}

/**
 * Parses find_files tool stdout into relative file paths (drops truncation footer lines).
 */
export function parseFindFilesOutputPaths(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('Error:')) return [];
  if (trimmed.startsWith('No files matching')) return [];
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('(truncated'));
}

/**
 * Lists executable orchestrate plan paths via find_files when npm start is available.
 */
export async function discoverOrchestratePlans(): Promise<DiscoverOrchestratePlansResult> {
  if (!isLocalServerAvailable()) {
    return { plans: [], error: 'server_off' };
  }

  const raw = (await executeTool('find_files', {
    path: 'documentation/plans',
    pattern: '**/*.md',
  })).content;

  const content = typeof raw === 'string' ? raw : '';
  const trimmed = content.trim();
  if (trimmed.startsWith('Error:')) {
    return {
      plans: [],
      error: trimmed.replace(/^Error:\s*/i, '').trim() || 'find_files failed',
    };
  }

  const paths = parseFindFilesOutputPaths(content);
  const plans = paths
    .filter((p) => isExecutableOrchestratePlan(p))
    .sort((a, b) => {
      const baseA = a.split('/').pop() ?? a;
      const baseB = b.split('/').pop() ?? b;
      const byBase = baseA.localeCompare(baseB);
      if (byBase !== 0) return byBase;
      return a.localeCompare(b);
    });

  return { plans };
}
