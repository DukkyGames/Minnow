import fs from 'node:fs/promises';
import path from 'node:path';
import { getBrainDir } from './paths.js';

/** @typedef {'agent-read' | 'agent-write' | 'synthesis-write' | 'proposal-accepted'} BrainUsageKind */

const VALID_KINDS = new Set([
  'agent-read',
  'agent-write',
  'synthesis-write',
  'proposal-accepted',
]);

export const USAGE_WEEKS_KEPT = 12;

function usagePath() {
  return path.join(getBrainDir(), 'usage.json');
}

/**
 * @param {Date} [date]
 * @returns {string}
 */
export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** @returns {Promise<{ version: number, weeks: Record<string, Record<string, number>> }>} */
async function loadStore() {
  try {
    const raw = await fs.readFile(usagePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: 1, weeks: {} };
    return {
      version: parsed.version ?? 1,
      weeks: parsed.weeks && typeof parsed.weeks === 'object' ? parsed.weeks : {},
    };
  } catch {
    return { version: 1, weeks: {} };
  }
}

/**
 * @param {Record<string, Record<string, number>>} weeks
 * @returns {Record<string, Record<string, number>>}
 */
export function pruneWeeks(weeks) {
  const keys = Object.keys(weeks).sort();
  const keep = keys.slice(-USAGE_WEEKS_KEPT);
  /** @type {Record<string, Record<string, number>>} */
  const out = {};
  for (const key of keep) out[key] = weeks[key];
  return out;
}

/**
 * @param {BrainUsageKind} kind
 * @param {Date} [now]
 * @returns {Promise<void>}
 */
export async function recordBrainUsage(kind, now = new Date()) {
  if (!VALID_KINDS.has(kind)) return;
  try {
    const store = await loadStore();
    const week = isoWeekKey(now);
    const bucket = store.weeks[week] ?? {};
    bucket[kind] = (bucket[kind] ?? 0) + 1;
    store.weeks[week] = bucket;
    store.weeks = pruneWeeks(store.weeks);

    const filePath = usagePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, filePath);
  } catch {
  }
}

/**
 * @param {Date} [now]
 * @returns {Promise<{ week: string, thisWeek: Record<string, number>, weeks: Record<string, Record<string, number>> }>}
 */
export async function readBrainUsage(now = new Date()) {
  const store = await loadStore();
  const week = isoWeekKey(now);
  return {
    week,
    thisWeek: store.weeks[week] ?? {},
    weeks: store.weeks,
  };
}
