/**
 * Plan mode write restrictions — only markdown plans under documentation/plans/.
 */

import { ORCHESTRATE_PLANS_PREFIX } from '../orchestrate/plan-path';
import { extractPathLikeArgs } from '../../tools/path-args';
import { normalizeModeId, type ModeId } from './types';

const PLANS_ROOT = ORCHESTRATE_PLANS_PREFIX.replace(/\/$/, '');
const PLANS_PREFIX_LOWER = ORCHESTRATE_PLANS_PREFIX.toLowerCase();
const SUPER_PLAN_REFERENCES_PREFIX = `${ORCHESTRATE_PLANS_PREFIX}references/`;
const SUPER_PLAN_REFERENCES_PREFIX_LOWER = SUPER_PLAN_REFERENCES_PREFIX.toLowerCase();

/** Super Plan reference artifacts (under documentation/plans/references/**). */
const SUPER_PLAN_REFERENCE_BASENAMES = new Set([
  'research-artifact.md',
  'build-spec.md',
]);

/** Tools Plan mode may use to create the plans tree or write plan files. */
const PLAN_SCOPED_WRITE_TOOLS = new Set(['save_file', 'make_directory']);

/** Other mutation tools remain blocked even if policy regresses. */
const PLAN_BLOCKED_WRITE_TOOLS = new Set([
  'append_file',
  'insert_at_line',
  'replace_text_in_file',
  'delete_path',
  'move_file',
  'copy_file',
]);

/**
 * True when a workspace-relative path is the plans root or a subdirectory.
 */
export function isUnderDocumentationPlans(relativePath: string): boolean {
  const trimmed = relativePath.trim().replace(/\\/g, '/');
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return lower === PLANS_PREFIX_LOWER.slice(0, -1) || lower.startsWith(PLANS_PREFIX_LOWER);
}

/**
 * True when the path is a markdown file under documentation/plans/.
 */
export function isPlanMarkdownPath(relativePath: string): boolean {
  const trimmed = relativePath.trim().replace(/\\/g, '/');
  if (!trimmed.toLowerCase().endsWith('.md')) return false;
  return isUnderDocumentationPlans(trimmed);
}

/**
 * True when the path is under documentation/plans/references/.
 */
export function isUnderSuperPlanReferences(relativePath: string): boolean {
  const trimmed = relativePath.trim().replace(/\\/g, '/');
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return (
    lower === SUPER_PLAN_REFERENCES_PREFIX_LOWER.slice(0, -1) ||
    lower.startsWith(SUPER_PLAN_REFERENCES_PREFIX_LOWER)
  );
}

/**
 * True when Super Plan may save a research-artifact or build-spec under references/.
 */
export function isSuperPlanReferenceArtifactPath(relativePath: string): boolean {
  const trimmed = relativePath.trim().replace(/\\/g, '/');
  if (!trimmed) return false;
  if (!isUnderSuperPlanReferences(trimmed)) return false;
  const basename = trimmed.split('/').pop()?.toLowerCase() ?? '';
  return SUPER_PLAN_REFERENCE_BASENAMES.has(basename);
}

function isPlanFamilyMode(modeId: ModeId | string): boolean {
  return modeId === 'plan' || modeId === 'super-plan';
}

function isAllowedPlanFamilySavePath(modeId: ModeId, relativePath: string): boolean {
  if (isPlanMarkdownPath(relativePath)) return true;
  if (modeId === 'super-plan' && isSuperPlanReferenceArtifactPath(relativePath)) {
    return true;
  }
  return false;
}

/**
 * Returns an error message when Plan mode blocks this write, or null when allowed.
 */
export function blockPlanModeWrite(
  modeId: ModeId | string | null | undefined,
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  const rawMode = typeof modeId === 'string' ? modeId : modeId ?? undefined;
  const normalized = normalizeModeId(rawMode);
  if (!isPlanFamilyMode(normalized)) return null;

  if (PLAN_BLOCKED_WRITE_TOOLS.has(toolName)) {
    return `Error: Plan mode only allows writing markdown plans under ${ORCHESTRATE_PLANS_PREFIX}`;
  }

  if (!PLAN_SCOPED_WRITE_TOOLS.has(toolName)) return null;

  const paths = extractPathLikeArgs(toolName, args);
  if (paths.length === 0) {
    return 'Error: path is required';
  }

  for (const p of paths) {
    if (toolName === 'save_file') {
      if (!isAllowedPlanFamilySavePath(normalized, p)) {
        const hint =
          normalized === 'super-plan'
            ? `${ORCHESTRATE_PLANS_PREFIX}*.md or ${SUPER_PLAN_REFERENCES_PREFIX}research-artifact.md / build-spec.md`
            : `${ORCHESTRATE_PLANS_PREFIX}*.md`;
        return `Error: ${normalized === 'super-plan' ? 'Super Plan' : 'Plan'} mode may only save_file to ${hint} (got "${p}")`;
      }
      continue;
    }
    if (toolName === 'make_directory' && !isUnderDocumentationPlans(p)) {
      return `Error: Plan mode may only make_directory under ${PLANS_ROOT}/ (got "${p}")`;
    }
  }

  return null;
}
