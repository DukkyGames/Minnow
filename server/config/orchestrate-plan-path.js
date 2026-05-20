/**
 * Server-side normalization for Chat.orchestratePlanPath (mirrors src/chat/orchestrate/plan-path.ts).
 */

const PREFIX = 'documentation/plans/';
const PREFIX_LEN = PREFIX.length;

/**
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function normalizeOrchestratePlanPath(raw) {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().replace(/\\/g, '/');
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (!lower.endsWith('.md')) return undefined;
  if (!lower.startsWith(PREFIX)) return undefined;
  const canonical = PREFIX + trimmed.slice(PREFIX_LEN);
  if (canonical.startsWith(`${PREFIX}references/`)) return undefined;
  if (canonical.startsWith(`${PREFIX}verification/`)) return undefined;
  return canonical;
}
