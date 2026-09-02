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
 * @param {SandboxSignalMeta | null | undefined} meta
 * @returns {string}
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
