/**
 * Workspace-relative paths for plan selection (planner, Super Plan, V2 Boards create).
 *
 * Lives under `src/chat/plans/` rather than `src/chat/orchestrate/` so the path
 * does not imply a board engine. MIN-714: presentation/listing only — V2 state
 * is `derive(journal)` on the server.
 *
 * Executable plans live under documentation/plans/ but exclude references/ and verification/.
 */

import type { Chat, ChatGroup } from '../../types';

/** Prefix for all orchestrate plan paths (workspace-relative, forward slashes). */
export const ORCHESTRATE_PLANS_PREFIX = 'documentation/plans/';

/** Canonical lowercase prefix for workspace-relative plan roots. */
const PLANS_PREFIX_LOWER = ORCHESTRATE_PLANS_PREFIX.toLowerCase();

/** Super Plan reference artifact basename suffixes (misplaced at plans root). */
const SUPER_PLAN_ARTIFACT_BASENAME = /-(spec|research|context)\.md$/i;

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

/**
 * True when the plan is a single file directly under documentation/plans/ (no nested folders).
 */
export function isTopLevelOrchestratePlan(path: string): boolean {
  const canonical = normalizeOrchestratePlanPath(path);
  if (!canonical) return false;
  const rest = canonical.slice(ORCHESTRATE_PLANS_PREFIX.length);
  return rest.length > 0 && !rest.includes('/');
}

/** True when the basename looks like a Super Plan reference artifact (spec / research / context). */
export function isSuperPlanReferenceArtifactBasename(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return SUPER_PLAN_ARTIFACT_BASENAME.test(base);
}

/**
 * Paths eligible for orchestrate plan dropdowns (top-level executable plans, not SP artifacts).
 */
export function isOrchestratePlanPickerEntry(path: string): boolean {
  return (
    isExecutableOrchestratePlan(path) &&
    isTopLevelOrchestratePlan(path) &&
    !isSuperPlanReferenceArtifactBasename(path)
  );
}

export function resolveEffectiveOrchestratePlanPath(
  chat: Chat,
  group?: ChatGroup | null,
): string | undefined {
  const fromChat = normalizeOrchestratePlanPath(chat.orchestratePlanPath ?? '');
  const fromGroup = group
    ? normalizeOrchestratePlanPath(group.orchestratePlanPath ?? '')
    : undefined;
  const fromBoard = group?.orchestrateBoard?.planPath
    ? normalizeOrchestratePlanPath(group.orchestrateBoard.planPath)
    : undefined;

  return fromChat ?? fromGroup ?? fromBoard;
}
