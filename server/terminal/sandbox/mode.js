/** @typedef {'off'|'prefer'|'require'} ShellSandboxMode */

export const SHELL_SANDBOX_MODES = Object.freeze(['off', 'prefer', 'require']);

/**
 * @param {unknown} value
 * @param {ShellSandboxMode} [fallback='off']
 * @returns {ShellSandboxMode}
 */
export function normalizeShellSandboxMode(value, fallback = 'off') {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === 'off' || raw === 'prefer' || raw === 'require') return raw;
  return fallback;
}

/**
 * @param {ShellSandboxMode} mode
 * @param {string} [platform]
 * @returns {ShellSandboxMode}
 */
export function clampShellSandboxModeForPlatform(mode, platform = process.platform) {
  if (platform === 'win32' && mode === 'require') {
    return 'prefer';
  }
  return mode;
}

/**
 * @param {object} [params]
 * @param {unknown} [params.globalMode]
 * @param {unknown} [params.boardMode]
 * @param {boolean} [params.onBoard]
 * @param {string} [params.platform]
 * @param {NodeJS.ProcessEnv} [params.env]
 * @returns {ShellSandboxMode}
 */
export function resolveEffectiveShellSandboxMode({
  globalMode,
  boardMode,
  onBoard = false,
  platform = process.platform,
  env = process.env,
} = {}) {
  const global = normalizeShellSandboxMode(globalMode, 'off');
  /** @type {ShellSandboxMode} */
  let mode;
  if (
    onBoard &&
    boardMode !== undefined &&
    boardMode !== null &&
    String(boardMode).trim() !== ''
  ) {
    mode = normalizeShellSandboxMode(boardMode, global);
  } else {
    mode = global;
  }

  if (mode === 'off' && env?.MINNOW_SHELL_SANDBOX === '1') {
    mode = 'prefer';
  }
  return clampShellSandboxModeForPlatform(mode, platform);
}

/**
 * @param {ShellSandboxMode} mode
 * @returns {boolean}
 */
export function modeAttemptsSandbox(mode) {
  return mode === 'prefer' || mode === 'require';
}

/**
 * @param {string} [detail]
 * @returns {string}
 */
export function formatRequireSandboxError(detail) {
  const why =
    typeof detail === 'string' && detail.trim()
      ? detail.trim()
      : 'Agent shell sandbox is not available on this platform';
  return (
    `Error: Agent shell sandbox is required but unavailable. ${why}. ` +
    'Install/enable the platform sandbox (macOS Seatbelt today; Linux Landlock and Windows WSL2+Landlock are planned), ' +
    'or set Settings → General → Agent shell sandbox to Prefer / Off, or override the board sandbox mode.'
  );
}

/**
 * @param {string} [detail]
 * @returns {string}
 */
export function formatPreferEscalationError(detail) {
  const why =
    typeof detail === 'string' && detail.trim()
      ? detail.trim()
      : 'Agent shell sandbox is not available';
  return (
    `Error: Agent shell sandbox unavailable (${why}). ` +
    'Approve an unsandboxed run in the Ask strip, or set Agent shell sandbox to Off.'
  );
}
