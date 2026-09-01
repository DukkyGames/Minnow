/**
 * Shared slugifier for user-typed git branch / worktree names (MIN-659).
 *
 * Composer and Source Control create flows auto-fix invalid input instead of
 * rejecting it: "Test Worktree" → "test-worktree". Board-task isolation keeps
 * its own slot naming in worktree-isolation.ts and must not import this for
 * those paths.
 */

/** Per-segment cap — keeps nested refs readable and Windows paths short. */
export const GIT_REF_SEGMENT_MAX = 64;

/** Whole-ref cap after joining slash-separated segments. */
export const GIT_REF_MAX = 200;

/** Fallback when a branch name sanitizes to nothing. */
export const GIT_REF_FALLBACK_BRANCH = 'branch';

/** Fallback when a worktree name sanitizes to nothing. */
export const GIT_REF_FALLBACK_WORKTREE = 'worktree';

/** Names git will not accept as a branch even after lowercasing. */
const FORBIDDEN_REFS = new Set(['head', '@']);

/**
 * Last path component of a file/folder path (POSIX or Windows separators).
 * @param {string} raw
 * @returns {string}
 */
export function pathBasename(raw) {
  const normalized = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '');
  if (!normalized) return '';
  return normalized.split('/').pop() ?? '';
}

/**
 * One git-ref path segment: lowercase, strip illegal chars, no leading dash/dot,
 * no trailing ".lock", bounded length. Empty when the source has no usable chars.
 * @param {string} raw
 * @returns {string}
 */
function slugifyGitRefSegment(raw) {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+/, '')
    .replace(/\.lock$/g, '')
    .slice(0, GIT_REF_SEGMENT_MAX)
    .replace(/[-.]+$/g, '');
  return cleaned;
}

/**
 * Same as {@link slugifyGitRefName} but returns '' when nothing usable remains
 * (so callers can try the next source instead of jumping to a generic fallback).
 * @param {string} raw
 * @returns {string}
 */
function slugifyGitRefNameOrEmpty(raw) {
  const source = String(raw ?? '').trim();
  if (!source) return '';

  const segments = source
    .split(/[/\\]+/)
    .map((segment) => slugifyGitRefSegment(segment))
    .filter(Boolean);

  let joined = segments.join('/');
  if (joined.length > GIT_REF_MAX) {
    joined = joined.slice(0, GIT_REF_MAX).replace(/\/+$/g, '');
  }

  if (!joined || FORBIDDEN_REFS.has(joined)) return '';
  return joined;
}

/**
 * Turn free-form user text into a valid git branch / worktree name.
 * Spaces and punctuation become hyphens; slashes stay as hierarchy separators
 * (`feature/My Branch` → `feature/my-branch`). Never returns an empty string.
 *
 * @param {string} raw
 * @param {string} [fallback]
 * @returns {string}
 */
export function slugifyGitRefName(raw, fallback = GIT_REF_FALLBACK_BRANCH) {
  const slug = slugifyGitRefNameOrEmpty(raw);
  if (slug) return slug;
  return slugifyGitRefNameOrEmpty(fallback) || GIT_REF_FALLBACK_BRANCH;
}

/**
 * Folder basename for a linked worktree: flatten slashes so `.worktrees/feature/foo`
 * does not nest extra directories.
 * @param {string} ref
 * @returns {string}
 */
export function gitRefFolderName(ref) {
  const slug = slugifyGitRefName(ref, GIT_REF_FALLBACK_WORKTREE);
  return slug.replace(/[/\\]+/g, '-') || GIT_REF_FALLBACK_WORKTREE;
}

/**
 * Pick a default branch/worktree name from a chat title or filesystem path.
 * Prefers the readable title slug; skips reserved names (current branch, trunk)
 * by appending -2, -3, … rather than minting an opaque id.
 *
 * @param {{
 *   title?: string,
 *   path?: string,
 *   fallback?: string,
 *   reserved?: Iterable<string | undefined | null>,
 * }} [input]
 * @returns {string}
 */
export function suggestGitRefName(input = {}) {
  const fallback =
    slugifyGitRefNameOrEmpty(input.fallback || '') || GIT_REF_FALLBACK_BRANCH;
  const fromTitle = slugifyGitRefNameOrEmpty(input.title ?? '');
  const fromPath = slugifyGitRefNameOrEmpty(pathBasename(input.path ?? ''));
  const base = fromTitle || fromPath || fallback;

  const taken = new Set();
  for (const value of input.reserved ?? []) {
    const trimmed = String(value ?? '').trim().toLowerCase();
    if (trimmed) taken.add(trimmed);
  }

  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = slugifyGitRefName(`${base}-${n}`, fallback);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return slugifyGitRefName(`${base}-work`, fallback);
}
