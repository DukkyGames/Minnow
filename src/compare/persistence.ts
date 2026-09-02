/**
 * Compare vote history: server API primary, localStorage fallback.
 */

import { isLocalServerAvailable } from '../tools/config';
import { normalizeCompareVote } from './win-rates';
import type { CompareVote, CompareVoteReveal, CompareWinner } from './types';

const LOCAL_KEY = 'minnow.compare.history';
const LOCAL_CAP = 50;
const LIST_CAP = 50;

function readLocalVotes(): CompareVote[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CompareVote[];
    return Array.isArray(parsed) ? parsed.filter((v) => v?.revealed) : [];
  } catch {
    return [];
  }
}

function writeLocalVotes(votes: CompareVote[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(votes.slice(0, LOCAL_CAP)));
}

/** Merge server and local votes; server wins on duplicate ids, newest first. */
export function mergeCompareVotes(server: CompareVote[], local: CompareVote[]): CompareVote[] {
  const byId = new Map<string, CompareVote>();
  for (const row of local) {
    if (row?.id) byId.set(row.id, row);
  }
  for (const row of server) {
    if (row?.id) byId.set(row.id, row);
  }
  return [...byId.values()]
    .map((vote) => normalizeCompareVote(vote))
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
    .slice(0, LIST_CAP);
}

/** List revealed compare votes. */
export async function listCompareHistory(limit = LIST_CAP): Promise<CompareVote[]> {
  const localVotes = readLocalVotes();
  if (isLocalServerAvailable()) {
    try {
      const res = await fetch(`/api/compare/history?limit=${limit}`, { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as CompareVote[];
        const serverVotes = Array.isArray(data) ? data.filter((v) => v?.revealed) : [];
        return mergeCompareVotes(serverVotes, localVotes);
      }
    } catch {}
  }
  return localVotes;
}

/** Submit a vote and persist the revealed record locally when needed. */
export async function submitCompareVote(
  sessionId: string,
  winner: CompareWinner,
  notes?: string,
): Promise<CompareVoteReveal> {
  const res = await fetch(`/api/compare/${encodeURIComponent(sessionId)}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner, notes }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Vote failed (${res.status})`);
  }
  const payload = (await res.json()) as CompareVoteReveal;
  const normalizedReveal: CompareVoteReveal = {
    ...payload,
    slots:
      Array.isArray(payload.slots) && payload.slots.length > 0
        ? payload.slots
        : normalizeCompareVote({
            id: sessionId,
            startedAt: '',
            completedAt: '',
            prompt: '',
            slots: [],
            winner: payload.winner,
            revealed: true,
            left: payload.left,
            right: payload.right,
            assignment: payload.assignment,
          }).slots,
  };
  const localVote: CompareVote = normalizeCompareVote({
    id: sessionId,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    prompt: '',
    slots: normalizedReveal.slots,
    winner: normalizedReveal.winner,
    revealed: true,
    left: normalizedReveal.left,
    right: normalizedReveal.right,
    assignment: normalizedReveal.assignment,
  });
  const existing = readLocalVotes();
  writeLocalVotes([localVote, ...existing.filter((v) => v.id !== sessionId)]);
  return normalizedReveal;
}

/** Mirror a server vote into localStorage (after successful server vote with full prompt). */
export async function cacheCompareVote(vote: CompareVote): Promise<void> {
  const existing = readLocalVotes();
  writeLocalVotes([vote, ...existing.filter((v) => v.id !== vote.id)]);
}

/** Clear local compare history. */
export function clearLocalCompareHistory(): void {
  localStorage.removeItem(LOCAL_KEY);
}
