import type { Message, PromptInjectionKind } from '../../types';
import {
  normalizeThinkingTriState,
  type ThinkingTriState,
} from '../../agents/thinking-types';
import { isInjectionNoticeMessage } from './injection-notice';

/** Latest stored body per injection kind. */
export type InjectionReplayBodies = Partial<Record<PromptInjectionKind, string>>;

function injectionBodyText(msg: Message): string {
  if (!isInjectionNoticeMessage(msg)) return '';
  const fromBody = msg.body?.trim();
  if (fromBody) return fromBody;
  const content = (msg as { content?: unknown }).content;
  return typeof content === 'string' ? content.trim() : '';
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
 * History rows win over the chat snapshot when both exist.
 */
export function resolveInjectionReplay(
  history: Message[],
  snapshot?: InjectionReplayBodies | null,
): InjectionReplayBodies {
  const fromHistory = latestInjectionBodies(history);
  if (!snapshot) return fromHistory;
  return { ...snapshot, ...fromHistory };
}
