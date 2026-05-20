/**
 * Workspace-relative paths for Orchestrate mode plan selection.
 * Executable plans live under documentation/plans/ but exclude references/ and verification/.
 */

/** Prefix for all orchestrate plan paths (workspace-relative, forward slashes). */
export const ORCHESTRATE_PLANS_PREFIX = 'documentation/plans/';

/** Canonical lowercase prefix for workspace-relative plan roots. */
const PLANS_PREFIX_LOWER = ORCHESTRATE_PLANS_PREFIX.toLowerCase();

/**
 * Builds canonical `documentation/plans/...` path or null when not under plans/*.md.
 */
function toCanonicalOrchestratePlanPath(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, '/');
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (!lower.endsWith('.md')) return null;
  if (!lower.startsWith(PLANS_PREFIX_LOWER)) return null;
  return ORCHESTRATE_PLANS_PREFIX + trimmed.slice(PLANS_PREFIX_LOWER.length);
}

/**
 * Returns a normalized persisted path, or undefined when invalid or not an executable plan.
 */
export function normalizeOrchestratePlanPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const canonical = toCanonicalOrchestratePlanPath(raw);
  if (!canonical) return undefined;
  if (canonical.startsWith(`${ORCHESTRATE_PLANS_PREFIX}references/`)) return undefined;
  if (canonical.startsWith(`${ORCHESTRATE_PLANS_PREFIX}verification/`)) return undefined;
  return canonical;
}

/**
 * True when the path is an executable orchestrate plan (markdown under plans/, not in excluded dirs).
 */
export function isExecutableOrchestratePlan(path: string): boolean {
  return normalizeOrchestratePlanPath(path) !== undefined;
}
