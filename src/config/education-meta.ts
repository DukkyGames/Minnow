/**
 * Education Mode settings in ~/.minnow/config.json (`education` block).
 *
 * Education Mode is a global overlay, not a mode: it transforms every operating
 * mode into a tutor that reads, runs, and reviews but never edits. The sync
 * getter is load-bearing — the tool filters and dispatch guards that enforce it
 * are synchronous and cannot await a fetch.
 */

import { detectConfigServer, isConfigServerMode } from './storage-mode';

/** How much scaffolding the teaching prompt asks for. */
export type EducationLevel = 'beginner' | 'intermediate' | 'advanced';

export interface EducationMeta {
  /** Master switch — strips write tools, guards dispatch, appends the tutor prompt. */
  enabled: boolean;
  level: EducationLevel;
}

const STORAGE_KEY = 'minnow.educationMeta';

export const EDUCATION_LEVELS: readonly EducationLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
];

export const DEFAULT_EDUCATION_META: EducationMeta = {
  enabled: false,
  level: 'beginner',
};

let cached: EducationMeta | null = null;

function normalizeLevel(raw: unknown): EducationLevel {
  if (typeof raw !== 'string') return DEFAULT_EDUCATION_META.level;
  const value = raw.trim().toLowerCase();
  return (EDUCATION_LEVELS as readonly string[]).includes(value)
    ? (value as EducationLevel)
    : DEFAULT_EDUCATION_META.level;
}

/** Parse the `education` block from config meta (tolerates missing/garbage). */
export function parseEducationBlock(raw: unknown): EducationMeta {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_EDUCATION_META };
  }
  const block = raw as Record<string, unknown>;
  return {
    enabled: block.enabled === true,
    level: normalizeLevel(block.level),
  };
}

function readLocal(): EducationMeta {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EDUCATION_META };
    return parseEducationBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EDUCATION_META };
  }
}

function writeLocal(config: EducationMeta): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Private-mode / quota failures must not disable the overlay.
  }
}

async function fetchFromServer(): Promise<EducationMeta> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocal();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseEducationBlock(meta.education);
}

/** Load education meta (cached, mirrored to localStorage for the sync getter). */
export async function loadEducationMeta(): Promise<EducationMeta> {
  if (cached) return cached;
  const mode = await detectConfigServer();
  cached = isConfigServerMode(mode) ? await fetchFromServer() : readLocal();
  writeLocal(cached);
  return cached;
}

/** Sync read for tool filters and guards (falls back to the localStorage mirror). */
export function getEducationMetaSync(): EducationMeta {
  return cached ?? readLocal();
}

/** True when Education Mode is on, without awaiting a load. */
export function isEducationModeEnabledSync(): boolean {
  return getEducationMetaSync().enabled;
}

/** Persist partial updates to config.json. */
export async function saveEducationMeta(patch: Partial<EducationMeta>): Promise<void> {
  const current = await loadEducationMeta();
  const next: EducationMeta = {
    enabled: patch.enabled !== undefined ? patch.enabled === true : current.enabled,
    level: patch.level !== undefined ? normalizeLevel(patch.level) : current.level,
  };
  cached = next;
  writeLocal(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ education: next }),
  });
}

/** Clear cache (tests). */
export function resetEducationMetaCache(): void {
  cached = null;
}

/** Override cache (tests). */
export function setEducationMetaForTests(config: EducationMeta | null): void {
  cached = config;
}
