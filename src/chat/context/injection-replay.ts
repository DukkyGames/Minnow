import type { Message, PromptInjectionKind } from '../../types';
import {
  normalizeThinkingTriState,
  type ThinkingTriState,
} from '../../agents/thinking-types';
import {
  isInjectionNoticeMessage,
  isTruncatedInjectionBody,
} from './injection-notice';

/** Latest stored body per injection kind. */
export type InjectionReplayBodies = Partial<Record<PromptInjectionKind, string>>;

function injectionBodyText(msg: Message): string {
  if (!isInjectionNoticeMessage(msg)) return '';
  const fromBody = msg.body?.trim();
  if (fromBody) return fromBody;
  const content = (msg as { content?: unknown }).content;
  return typeof content === 'string' ? content.trim() : '';
}

/** Transcript rows are capped at the storage limit; the chat snapshot is not. */
function isTruncatedRow(msg: Message, body: string): boolean {
  if (isInjectionNoticeMessage(msg) && msg.truncated === true) return true;
  return isTruncatedInjectionBody(body);
}

export function latestInjectionBodies(history: Message[]): InjectionReplayBodies {
  const bodies: InjectionReplayBodies = {};
  for (const msg of history) {
    if (!isInjectionNoticeMessage(msg)) continue;
    const body = injectionBodyText(msg);
    if (!body) continue;
    bodies[msg.kind] = body;
  }
  return bodies;
}

/** Kinds whose newest transcript row was cut for storage. */
function truncatedKinds(history: Message[]): Set<PromptInjectionKind> {
  const cut = new Set<PromptInjectionKind>();
  for (const msg of history) {
    if (!isInjectionNoticeMessage(msg)) continue;
    const body = injectionBodyText(msg);
    if (!body) continue;
    if (isTruncatedRow(msg, body)) cut.add(msg.kind);
    else cut.delete(msg.kind);
  }
  return cut;
}

/**
 * Keep a stored injection on later turns unless the user turned that source off.
 * Do not re-run live retrieve gates (Brain code config, memory store health) —
 * those can fail on follow-up sends and drop notes/map that already injected.
 */
export function shouldReplayStoredInjection(tri?: ThinkingTriState): boolean {
  return normalizeThinkingTriState(tri, 'inherit') !== 'off';
}

/**
 * Follow-up turns reuse first-turn stored bodies.
 *
 * History rows win over the chat snapshot when both exist — except for a row the
 * 24k transcript cap cut. Replaying that shortened body shrinks the prompt on turn 2
 * (a full code map is ~40k chars), so the untruncated snapshot wins there.
 */
export function resolveInjectionReplay(
  history: Message[],
  snapshot?: InjectionReplayBodies | null,
): InjectionReplayBodies {
  const fromHistory = latestInjectionBodies(history);
  if (!snapshot) return fromHistory;
  const merged: InjectionReplayBodies = { ...snapshot, ...fromHistory };
  for (const kind of truncatedKinds(history)) {
    const full = snapshot[kind]?.trim();
    if (full) merged[kind] = full;
  }
  return merged;
}
