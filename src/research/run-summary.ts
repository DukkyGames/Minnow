/**
 * Run summary formatting.
 *
 * The engine persists stats in its own display shape — capitalised keys and a
 * raw seconds string (`{ Duration: '476.8s', Rounds: 3, URLs: 35 }`) — while
 * `ResearchStats` describes the lower-cased shape. Read both here so the rail
 * and the run header agree, rather than each guessing at one of them.
 */

import type { ResearchStats } from './types';

/** Wire shape written by `server/research/engine.js`. */
interface WireStats {
  Duration?: string;
  Rounds?: number | string;
  Queries?: number | string;
  URLs?: number | string;
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Read a duration written as raw seconds (`476.8s`) back as a clock. */
export function formatRunDuration(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  const seconds = /^([\d.]+)\s*s$/i.exec(trimmed);
  if (!seconds) {
    return trimmed;
  }
  const total = Math.round(Number(seconds[1]));
  if (!Number.isFinite(total)) {
    return trimmed;
  }
  return formatSecondsClock(total);
}

/** Seconds as `m:ss`. */
export function formatSecondsClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface RunSummary {
  sources?: number;
  rounds?: number;
  duration: string;
}

/** Read either stats shape into one summary. */
export function normalizeResearchStats(
  stats: (ResearchStats & WireStats) | undefined,
  sourceCount = 0,
): RunSummary {
  const wire = stats as WireStats | undefined;
  const duration =
    stats?.durationSeconds != null
      ? formatSecondsClock(stats.durationSeconds)
      : formatRunDuration(wire?.Duration ?? '');
  return {
    sources: num(stats?.sources) ?? num(sourceCount),
    rounds: num(stats?.rounds) ?? num(wire?.Rounds),
    duration,
  };
}

/** `23 sources · 3 rounds · 7:57` */
export function formatRunSummary(summary: RunSummary): string {
  const parts: string[] = [];
  if (summary.sources) {
    parts.push(`${summary.sources} source${summary.sources === 1 ? '' : 's'}`);
  }
  if (summary.rounds) {
    parts.push(`${summary.rounds} round${summary.rounds === 1 ? '' : 's'}`);
  }
  if (summary.duration) {
    parts.push(summary.duration);
  }
  return parts.join(' · ');
}
