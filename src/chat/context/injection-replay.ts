/**
 * Replay first-turn prompt injections from persisted transcript rows.
 *
 * Injections only run on the first user turn, but the prompt is recomposed on
 * every send — so from turn 2 onward the Brain-notes / code-map / context-document
 * blocks were rebuilt as `null` and the model simply stopped seeing them. The
 * `injection` rows already hold the exact retrieved text, so replay reads them back
 * instead of re-deriving (and re-persisting) anything.
 */

import type { Message, PromptInjectionKind } from '../../types';
import { estimateTokensFromText } from '../prompts/token-estimate-core';
import { isInjectionNoticeMessage } from './injection-notice';

/** Latest stored body per injection kind. */
export type InjectionReplayBodies = Partial<Record<PromptInjectionKind, string>>;

/**
 * Replayed blocks land as pinned system content that `applyContextPolicy` never
 * trims, so they get a hard share of the window rather than the whole thing.
 */
export const INJECTION_REPLAY_CONTEXT_SHARE = 0.2;

/** Cap used when the model context window is unknown. */
export const INJECTION_REPLAY_FALLBACK_TOKEN_CAP = 8_000;

/**
 * Priority order when the cap cannot hold everything. Workspace docs are the
 * user's own authored context (AGENTS.md and friends) and matter most; the code
 * map is the most re-derivable, so it is dropped first.
 */
export const INJECTION_REPLAY_PRIORITY: PromptInjectionKind[] = [
  'context-documents',
  'brain-notes',
  'code-map',
];

/**
 * Last persisted body per injection kind. Injections only ever run on the first
 * user turn, so there is at most one row per kind — but take the last anyway so a
 * forked or re-seeded transcript replays what it actually last sent.
 */
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

/**
 * Trim a replay set to the token cap. A kind that does not fit is dropped whole —
 * a half-truncated code map or context document is worse than none at all.
 */
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
