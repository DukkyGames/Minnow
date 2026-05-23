/**
 * Plan mode write restrictions for POST /api/tools (mirrors src/chat/modes/plan-write-guard.ts).
 */

const ORCHESTRATE_PLANS_PREFIX = 'documentation/plans/';
const PLANS_ROOT = ORCHESTRATE_PLANS_PREFIX.replace(/\/$/, '');
const PLANS_PREFIX_LOWER = ORCHESTRATE_PLANS_PREFIX.toLowerCase();

const MODE_IDS = new Set(['build', 'plan', 'orchestrate', 'research', 'reef']);

const PLAN_SCOPED_WRITE_TOOLS = new Set(['save_file', 'make_directory']);

const PLAN_BLOCKED_WRITE_TOOLS = new Set([
  'append_file',
  'insert_at_line',
  'replace_text_in_file',
  'delete_path',
  'move_file',
  'copy_file',
]);

/** Argument keys that hold paths for plan write checks. */
const TOOL_PATH_ARG_KEYS = {
  save_file: ['path'],
  make_directory: ['path'],
  append_file: ['path'],
  insert_at_line: ['path'],
  replace_text_in_file: ['path'],
  delete_path: ['path'],
  move_file: ['source', 'destination'],
  copy_file: ['source', 'destination'],
};

/**
 * @param {string | null | undefined} value
 * @returns {'build' | 'plan' | 'orchestrate' | 'research' | 'reef'}
 */
export function normalizeModeId(value) {
  if (typeof value === 'string' && MODE_IDS.has(value)) {
    return value;
  }
  return 'build';
}

/**
 * @param {unknown} body
 * @returns {string | undefined}
 */
export function resolveModeIdFromToolsBody(body) {
  if (body && typeof body === 'object' && body.planMode === true) {
    return 'plan';
  }
  const modeId = body?.modeId;
  return typeof modeId === 'string' && modeId.trim() ? modeId.trim() : undefined;
}

/**
 * @param {string} relativePath
 */
export function isUnderDocumentationPlans(relativePath) {
  const trimmed = relativePath.trim().replace(/\\/g, '/');
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return lower === PLANS_PREFIX_LOWER.slice(0, -1) || lower.startsWith(PLANS_PREFIX_LOWER);
}

/**
 * @param {string} relativePath
 */
export function isPlanMarkdownPath(relativePath) {
  const trimmed = relativePath.trim().replace(/\\/g, '/');
  if (!trimmed.toLowerCase().endsWith('.md')) return false;
  return isUnderDocumentationPlans(trimmed);
}

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {string[]}
 */
function extractPathLikeArgs(toolName, args) {
  const keys = TOOL_PATH_ARG_KEYS[toolName];
  const out = [];
  if (keys) {
    for (const key of keys) {
      const v = args[key];
      if (typeof v === 'string' && v.trim()) {
        out.push(v.trim());
      }
    }
  }
  return out;
}

/**
 * Returns an error message when Plan mode blocks this write, or null when allowed.
 *
 * @param {string | null | undefined} modeId
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {string | null}
 */
export function blockPlanModeWrite(modeId, toolName, args) {
  const normalized = normalizeModeId(
    typeof modeId === 'string' ? modeId : modeId ?? undefined,
  );
  if (normalized !== 'plan') return null;

  if (PLAN_BLOCKED_WRITE_TOOLS.has(toolName)) {
    return `Error: Plan mode only allows writing markdown plans under ${ORCHESTRATE_PLANS_PREFIX}`;
  }

  if (!PLAN_SCOPED_WRITE_TOOLS.has(toolName)) return null;

  const paths = extractPathLikeArgs(toolName, args ?? {});
  if (paths.length === 0) {
    return 'Error: path is required';
  }

  for (const p of paths) {
    if (toolName === 'save_file') {
      if (!isPlanMarkdownPath(p)) {
        return `Error: Plan mode may only save_file to ${ORCHESTRATE_PLANS_PREFIX}*.md (got "${p}")`;
      }
      continue;
    }
    if (toolName === 'make_directory' && !isUnderDocumentationPlans(p)) {
      return `Error: Plan mode may only make_directory under ${PLANS_ROOT}/ (got "${p}")`;
    }
  }

  return null;
}
