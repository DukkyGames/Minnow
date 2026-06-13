/**
 * Browser client for memory/skill synthesis proposal APIs.
 */

import { detectLocalServer } from '../tools/client';

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
  maxProposalsPerTurn: number;
  throttleMessagePairs: number;
  skillMinRounds: number;
  skillMinToolCalls: number;
  utilityProviderId: string;
  utilityModelId: string;
  maxPendingProposals: number;
  rejectedRetentionDays: number;
}

async function synthesisFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const ok = await detectLocalServer();
  if (!ok) return null;
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
  const ok = await detectLocalServer();
  if (!ok) return null;
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
  const ok = await detectLocalServer();
  if (!ok) return false;
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
  const ok = await detectLocalServer();
  if (!ok) return false;
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
  const ok = await detectLocalServer();
  if (!ok) return false;
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
  const ok = await detectLocalServer();
  if (!ok) return false;
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
}

/**
 * Fire-and-forget post-turn synthesis (non-blocking).
 * Skips when assistant response is empty or mode is debug.
 */
export function schedulePostTurnSynthesis(input: SynthesisRunInput): void {
  if (!input.assistantText?.trim()) return;

  void (async () => {
    const ok = await detectLocalServer();
    if (!ok) return;

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
        }),
      });
      if (!res.ok) return;

      const data = (await res.json()) as {
        memoryProposals?: unknown[];
        skillProposal?: unknown | null;
      };
      const created =
        (data.memoryProposals?.length ?? 0) + (data.skillProposal ? 1 : 0);
      if (created > 0) {
        const { noteAgentMessage } = await import('../os/instances');
        noteAgentMessage(
          'settings',
          `${created} new memory/skill proposal${created === 1 ? '' : 's'} ready for review`,
        );
      }
    } catch {
      /* synthesis is best-effort */
    }
  })();
}
