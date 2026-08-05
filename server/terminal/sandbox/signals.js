/**
 * Honest sandbox signals for tool results / UI / board log (MIN-553 Phase 3).
 */

/**
 * @typedef {object} SandboxSignalMeta
 * @property {boolean} [applied]
 * @property {string} [kind]
 * @property {string} [profile]
 * @property {string} [reason]
 * @property {string} [detail]
 * @property {string} [mode]
 * @property {boolean} [fallbackUnsandboxed]
 * @property {boolean} [blocked]
 * @property {boolean} [needsEscalation]
 */

/**
 * Trailer appended to tool results so the model sees containment status.
 * Empty when sandbox is off / disabled (no noise on the default path).
 *
 * @param {SandboxSignalMeta | null | undefined} meta
 * @returns {string} bare trailer without leading newlines, or ''
 */
export function formatSandboxTrailer(meta) {
  if (!meta || typeof meta !== 'object') return '';
  if (meta.blocked || meta.needsEscalation) return '';
  if (meta.applied === true) {
    const kind = typeof meta.kind === 'string' && meta.kind.trim() ? meta.kind.trim() : 'sandbox';
    const profile =
      typeof meta.profile === 'string' && meta.profile.trim() ? meta.profile.trim() : 'workspace';
    return `[sandboxed: ${kind}/${profile}]`;
  }

  const mode = meta.mode;
  // Only emit NOT-sandboxed when we attempted containment (prefer/require) or fell back.
  if (mode !== 'prefer' && mode !== 'require' && meta.fallbackUnsandboxed !== true) {
    return '';
  }
  if (meta.reason === 'disabled' || meta.reason === 'user_pty') return '';

  const detail =
    (typeof meta.detail === 'string' && meta.detail.trim()) ||
    (typeof meta.reason === 'string' && meta.reason.trim()) ||
    'unavailable';
  return `[NOT sandboxed: ${detail}]`;
}

/**
 * Append trailer to a formatted process/tool result string.
 * @param {string} formatted
 * @param {SandboxSignalMeta | null | undefined} meta
 * @returns {string}
 */
export function appendSandboxTrailer(formatted, meta) {
  const trailer = formatSandboxTrailer(meta);
  if (!trailer) return formatted;
  const base = typeof formatted === 'string' ? formatted : String(formatted ?? '');
  return `${base}\n\n${trailer}`;
}

/**
 * Parse sandbox trailer from a tool-result string (UI badge).
 * @param {string} content
 * @returns {{ sandboxed: boolean, label: string } | null}
 */
export function parseSandboxTrailer(content) {
  const text = typeof content === 'string' ? content : '';
  const sandboxed = text.match(/\[sandboxed:\s*([^\]]+)\]/i);
  if (sandboxed) {
    return { sandboxed: true, label: sandboxed[1].trim() };
  }
  const notSandboxed = text.match(/\[NOT sandboxed:\s*([^\]]+)\]/i);
  if (notSandboxed) {
    return { sandboxed: false, label: notSandboxed[1].trim() };
  }
  return null;
}
