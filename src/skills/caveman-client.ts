/**
 * Client-side caveman intensity parsing and skill body augmentation for /caveman sends.
 */

export const CAVEMAN_SKILL_ID = 'caveman';

export const DEFAULT_CAVEMAN_INTENSITY = 'full';

/** Supported caveman compression levels (first token after /caveman). */
export const CAVEMAN_INTENSITIES = [
  'lite',
  'full',
  'ultra',
  'wenyan-lite',
  'wenyan-full',
  'wenyan-ultra',
] as const;

export type CavemanIntensity = (typeof CAVEMAN_INTENSITIES)[number];

const CAVEMAN_INTENSITY_SET = new Set<string>(CAVEMAN_INTENSITIES);

/** Return first token when it is a known caveman intensity level. */
export function parseCavemanIntensity(userText: string): CavemanIntensity | null {
  const first = userText.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first || !CAVEMAN_INTENSITY_SET.has(first)) {
    return null;
  }
  return first as CavemanIntensity;
}

/** Remove a leading intensity token from user text after /caveman. */
export function stripLeadingCavemanIntensity(userText: string): {
  userText: string;
  intensity: CavemanIntensity | null;
} {
  const intensity = parseCavemanIntensity(userText);
  if (!intensity) {
    return { userText, intensity: null };
  }
  const rest = userText.trim().slice(intensity.length).trim();
  return { userText: rest, intensity };
}

export function isCavemanIntensity(value: string | undefined | null): value is CavemanIntensity {
  return typeof value === 'string' && CAVEMAN_INTENSITY_SET.has(value);
}

export interface AugmentCavemanSkillBodyOptions {
  userText: string;
  pinnedIntensity?: string | null;
}

/** Append active intensity block when pinned or parsed from the user message. */
export function augmentCavemanSkillBody(
  skillBody: string,
  options: AugmentCavemanSkillBodyOptions,
): string {
  const parsed = parseCavemanIntensity(options.userText);
  const intensity =
    parsed ??
    (isCavemanIntensity(options.pinnedIntensity)
      ? options.pinnedIntensity
      : DEFAULT_CAVEMAN_INTENSITY);

  return `${skillBody.trim()}

---
## Active intensity: ${intensity}
(apply this level until user changes level, dismisses the pin, or says stop caveman / normal mode)`;
}
