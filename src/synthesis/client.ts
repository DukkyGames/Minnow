/**
 * Browser client for memory/skill synthesis proposal APIs.
 */

import { isLocalServerAvailable } from '../tools/config';

const API_BASE = '';

export type MemoryProposalCategory =
  | 'identity'
  | 'preference'
  | 'fact'
  | 'contact'
  | 'project'
  | 'goal';

export type ProposalStatus = 'pending' | 'accepted' | 'rejected';

export interface MemoryProposal {
  id: string;
  createdAt: string;
  sourceChatId?: string;
  sourceExcerpt?: string;
  title: string;
  body: string;
  tags: string[];
  category: MemoryProposalCategory;
  confidence: number;
  rationale: string;
  status: ProposalStatus;
}

export interface SkillProposal {
  id: string;
  createdAt: string;
  sourceChatId?: string;
  title: string;
  skillMdDraft: string;
  tags: string[];
  confidence: number;
  rationale: string;
  status: ProposalStatus;
}

export interface SynthesisStatus {
  memoryPending: number;
  skillPending: number;
  totalPending: number;
}

export interface SynthesisConfig {
  enabled: boolean;
  requireConfirmation: boolean;
  confidenceThreshold: number;
  /** Facts at or above this confidence are written directly; below it they queue as proposals. */
  autoWriteConfidence: number;
  maxProposalsPerTurn: number;
  throttleMessagePairs: number;
  skillMinRounds: number;
  skillMinToolCalls: number;
  /** Distinct sessions that must hit the same problem class before a skill is proposed. */
  skillMinOccurrences: number;
  skillObservationRetentionDays: number;
  utilityProviderId: string;
  utilityModelId: string;
  maxPendingProposals: number;
  rejectedRetentionDays: number;
}

async function synthesisFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  if (!isLocalServerAvailable()) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Load synthesis settings from the server. */
export async function fetchSynthesisConfig(): Promise<SynthesisConfig | null> {
  const data = await synthesisFetch<{ synthesis: SynthesisConfig }>(
    '/api/memory/synthesis/config',
  );
  return data?.synthesis ?? null;
}

/** Save partial synthesis settings. */
export async function saveSynthesisConfig(
  partial: Partial<SynthesisConfig>,
): Promise<SynthesisConfig | null> {
  if (!isLocalServerAvailable()) return null;
  try {
    const res = await fetch(`${API_BASE}/api/memory/synthesis/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { synthesis: SynthesisConfig };
    return data.synthesis ?? null;
  } catch {
    return null;
  }
}

/** Pending proposal counts for settings badge. */
export async function fetchSynthesisStatus(): Promise<SynthesisStatus | null> {
  return synthesisFetch<SynthesisStatus>('/api/memory/synthesis/status');
}

/** List pending memory proposals. */
export async function fetchMemoryProposals(
  status: ProposalStatus = 'pending',
): Promise<MemoryProposal[] | null> {
  const data = await synthesisFetch<{ proposals: MemoryProposal[] }>(
    `/api/memory/proposals?status=${encodeURIComponent(status)}`,
  );
  return data?.proposals ?? null;
}

/** List pending skill proposals. */
export async function fetchSkillProposals(
  status: ProposalStatus = 'pending',
): Promise<SkillProposal[] | null> {
  const data = await synthesisFetch<{ proposals: SkillProposal[] }>(
    `/api/skills/proposals?status=${encodeURIComponent(status)}`,
  );
  return data?.proposals ?? null;
}

/** Accept a memory proposal (optional inline edits). */
export async function acceptMemoryProposal(
  id: string,
  edits?: { title?: string; body?: string; tags?: string[] },
): Promise<boolean> {
  if (!isLocalServerAvailable()) return false;
  try {
    const res = await fetch(
      `${API_BASE}/api/memory/proposals/${encodeURIComponent(id)}/accept`,
      {
        method: 'POST',
        body: JSON.stringify(edits ?? {}),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Reject a memory proposal. */
export async function rejectMemoryProposal(id: string): Promise<boolean> {
  if (!isLocalServerAvailable()) return false;
  try {
    const res = await fetch(
      `${API_BASE}/api/memory/proposals/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: '{}' },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Accept a skill proposal (optional SKILL.md edit). */
export async function acceptSkillProposal(
  id: string,
  edits?: { skillMdDraft?: string },
): Promise<boolean> {
  if (!isLocalServerAvailable()) return false;
  try {
    const res = await fetch(
      `${API_BASE}/api/skills/proposals/${encodeURIComponent(id)}/accept`,
      {
        method: 'POST',
        body: JSON.stringify(edits ?? {}),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Reject a skill proposal. */
export async function rejectSkillProposal(id: string): Promise<boolean> {
  if (!isLocalServerAvailable()) return false;
  try {
    const res = await fetch(
      `${API_BASE}/api/skills/proposals/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: '{}' },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export interface SynthesisRunMessage {
  role: string;
  content: string;
}

export interface SynthesisRunInput {
  chatId: string;
  messages: SynthesisRunMessage[];
  roundCount: number;
  toolCount: number;
  sourceExcerpt?: string;
  assistantText?: string;
  /** Bypass throttle — use for completion-triggered writes (board tasks). */
  force?: boolean;
  /** Explicit model binding so background synthesis doesn't fall back to active chat. */
  providerId?: string;
  modelId?: string;
}

/**
 * Fire-and-forget post-turn synthesis (non-blocking).
 * Skips when assistant response is empty or mode is debug.
 */
export function schedulePostTurnSynthesis(input: SynthesisRunInput): void {
  if (!input.assistantText?.trim()) return;

  void (async () => {
    if (!isLocalServerAvailable()) return;

    try {
      const res = await fetch(`${API_BASE}/api/memory/synthesis/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: input.chatId,
          messages: input.messages,
          roundCount: input.roundCount,
          toolCount: input.toolCount,
          sourceExcerpt: input.sourceExcerpt,
          ...(input.force ? { force: true } : {}),
          ...(input.providerId ? { providerId: input.providerId } : {}),
          ...(input.modelId ? { modelId: input.modelId } : {}),
        }),
      });
      if (!res.ok) return;

      const data = (await res.json()) as {
        memoryProposals?: unknown[];
        memoryPages?: unknown[];
        memorySkipped?: string[];
        skillProposal?: unknown | null;
      };
      if (data.memorySkipped?.includes('no-model')) {
        console.warn(
          '[synthesis] Skipped: no utility model resolved. Pick a model in the menubar or Settings → Memory → Synthesis.',
        );
      }
      const savedPages = data.memoryPages?.length ?? 0;
      const proposals =
        (data.memoryProposals?.length ?? 0) + (data.skillProposal ? 1 : 0);
      if (savedPages > 0 || proposals > 0) {
        const parts: string[] = [];
        if (savedPages > 0) {
          parts.push(`${savedPages} memor${savedPages === 1 ? 'y' : 'ies'} saved`);
        }
        if (proposals > 0) {
          parts.push(
            `${proposals} proposal${proposals === 1 ? '' : 's'} ready for review`,
          );
        }
        const { pushNotification } = await import('../notifications/push');
        pushNotification({
          kind: 'synthesis',
          title: 'Auto-learning',
          preview: parts.join(' · '),
          appId: savedPages > 0 ? 'brain' : 'settings',
          dedupeKey: `synthesis:${input.chatId}:${savedPages}:${proposals}`,
        });
      }
    } catch {
      /* synthesis is best-effort */
    }
  })();
}
