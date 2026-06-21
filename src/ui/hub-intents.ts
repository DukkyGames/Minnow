/**
 * Pure helpers for Vibe Coding Hub intent chips (testable without DOM).
 */

import type { ModeId } from '../chat/modes/types';

export type HubIntentId = 'build' | 'plan' | 'explain' | 'debug' | 'orchestrate';

/** Map hub intent chips to Minnow operating modes. */
export function mapIntentModeId(intent: HubIntentId): ModeId {
  if (intent === 'plan') return 'plan';
  if (intent === 'explain') return 'general';
  if (intent === 'debug') return 'debug';
  return 'build';
}

/** Prefill text for each intent chip. */
export function intentPrefill(intent: HubIntentId): string {
  if (intent === 'plan') return 'Plan a change to ';
  if (intent === 'explain') return 'Explain how this repo is structured.';
  if (intent === 'debug') return 'Help me debug: ';
  return 'Build a new feature: ';
}
