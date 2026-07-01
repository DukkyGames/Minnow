/**
 * Client helpers for /partymode — Bird Man persona and sticky pin detection.
 */

import type { PinnedSkillState } from './types';

export const PARTYMODE_SKILL_ID = 'partymode';

/** User phrases that dismiss the party mode pin. */
const PARTY_STOP_RE = /\b(stop\s+party(?:\s+mode)?|party(?:'?s)?\s+over)\b/i;

/** Detect user intent to exit party mode. */
export function isPartyModeStopPhrase(text: string): boolean {
  return PARTY_STOP_RE.test(text.trim());
}

/** True when the chat has party mode pinned for confetti + composer chrome. */
export function isPartyModePinned(pinned: PinnedSkillState | null | undefined): boolean {
  return pinned?.id === PARTYMODE_SKILL_ID;
}

/** Reinforce Bird Man sign-off while party mode is active on this turn. */
export function augmentPartyModeSkillBody(body: string): string {
  return `${body.trim()}

## Active session

Party mode is **ON**. You are Bird Man — your local party animal. Keep the cool-dude energy. End **every** response with this exact line on its own paragraph:

Do you guys like to party?`;
}
