/**
 * Client helpers for Work Agent prompt editor API.
 */

export type WorkAgentPromptProfile = 'full' | 'lite';

export interface WorkAgentPromptResponse {
  content: string;
  source: 'builtin' | 'override';
}

/** Fetch prompt body for an agent (built-in or user override). */
export async function fetchWorkAgentPrompt(
  agentId: string,
  profile: WorkAgentPromptProfile = 'full',
): Promise<WorkAgentPromptResponse | null> {
  try {
    const res = await fetch(
      `/api/work-agents/${encodeURIComponent(agentId)}/prompt?profile=${profile}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as WorkAgentPromptResponse;
  } catch {
    return null;
  }
}

/** Persist user prompt override under ~/.speedchat/prompts/work-agents/. */
export async function saveWorkAgentPromptOverride(
  agentId: string,
  profile: WorkAgentPromptProfile,
  content: string,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/work-agents/${encodeURIComponent(agentId)}/prompt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, content }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** List agents from server registry (invalidates client cache on success). */
export async function fetchWorkAgentsList(): Promise<{
  agents: import('./work-agent-types').WorkAgentDefinition[];
} | null> {
  try {
    const res = await fetch('/api/work-agents', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as { agents: import('./work-agent-types').WorkAgentDefinition[] };
  } catch {
    return null;
  }
}
