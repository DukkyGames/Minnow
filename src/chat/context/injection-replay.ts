import type { Message, PromptInjectionKind } from '../../types';
import { estimateTokensFromText } from '../prompts/token-estimate-core';
import { isInjectionNoticeMessage } from './injection-notice';

/** Latest stored body per injection kind. */
export type InjectionReplayBodies = Partial<Record<PromptInjectionKind, string>>;

export const INJECTION_REPLAY_CONTEXT_SHARE = 0.2;

/** Cap used when the model context window is unknown. */
export const INJECTION_REPLAY_FALLBACK_TOKEN_CAP = 8_000;

export const INJECTION_REPLAY_PRIORITY: PromptInjectionKind[] = [
  'context-documents',
  'brain-notes',
  'code-map',
];

export function latestInjectionBodies(history: Message[]): InjectionReplayBodies {
  const bodies: InjectionReplayBodies = {};
  for (const msg of history) {
    if (!isInjectionNoticeMessage(msg)) continue;
    const body = msg.body?.trim();
    if (!body) continue;
    bodies[msg.kind] = body;
  }
  return bodies;
}

export interface CapInjectionReplayOptions {
  /** Model context window in tokens; null/undefined falls back to a fixed cap. */
  modelContextLimit?: number | null;
}

/** Token budget a replay may occupy for this model. */
export function resolveInjectionReplayTokenCap(
  modelContextLimit?: number | null,
): number {
  if (
    typeof modelContextLimit === 'number' &&
    Number.isFinite(modelContextLimit) &&
    modelContextLimit > 0
  ) {
    return Math.floor(modelContextLimit * INJECTION_REPLAY_CONTEXT_SHARE);
  }
  return INJECTION_REPLAY_FALLBACK_TOKEN_CAP;
}

export function capInjectionReplay(
  bodies: InjectionReplayBodies,
  options?: CapInjectionReplayOptions,
): InjectionReplayBodies {
  const cap = resolveInjectionReplayTokenCap(options?.modelContextLimit);
  const out: InjectionReplayBodies = {};
  let used = 0;
  for (const kind of INJECTION_REPLAY_PRIORITY) {
    const body = bodies[kind]?.trim();
    if (!body) continue;
    const cost = estimateTokensFromText(body);
    if (used + cost > cap) continue;
    out[kind] = body;
    used += cost;
  }
  return out;
}

/** Latest stored injection bodies for this history, capped for the model. */
export function resolveInjectionReplay(
  history: Message[],
  options?: CapInjectionReplayOptions,
): InjectionReplayBodies {
  return capInjectionReplay(latestInjectionBodies(history), options);
}
