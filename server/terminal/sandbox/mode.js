/**
 * Three-state agent shell sandbox mode resolution (MIN-553 Phase 3).
 *
 * Global: toolSecurity.shellSandbox ∈ off | prefer | require (default off).
 * Boards: autopilot.shellSandbox default require (overridable per board).
 * Dev: MINNOW_SHELL_SANDBOX=1 elevates off → prefer.
 */

/** @typedef {'off'|'prefer'|'require'} ShellSandboxMode */

export const SHELL_SANDBOX_MODES = Object.freeze(['off', 'prefer', 'require']);

/**
 * Coerce unknown config values to a valid mode.
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
 * Resolve the effective mode for one agent shell spawn.
 *
 * @param {object} [params]
 * @param {unknown} [params.globalMode] toolSecurity.shellSandbox
 * @param {unknown} [params.boardMode] per-board override (undefined = inherit)
 * @param {unknown} [params.autopilotBoardDefault] autopilot.shellSandbox (boards only)
 * @param {boolean} [params.onBoard]
 * @param {NodeJS.ProcessEnv} [params.env]
 * @returns {ShellSandboxMode}
 */
export function resolveEffectiveShellSandboxMode({
  globalMode,
  boardMode,
  autopilotBoardDefault = 'require',
  onBoard = false,
  env = process.env,
} = {}) {
  /** @type {ShellSandboxMode} */
  let mode;
  if (onBoard) {
    // Board path: explicit board override → autopilot default (require) — not global off.
    if (boardMode !== undefined && boardMode !== null && String(boardMode).trim() !== '') {
      mode = normalizeShellSandboxMode(boardMode, 'require');
    } else {
      mode = normalizeShellSandboxMode(autopilotBoardDefault, 'require');
    }
  } else {
    mode = normalizeShellSandboxMode(globalMode, 'off');
  }

  // Dev canary / local force-enable: treat as prefer (Ask on unavailable, not hard-fail).
  if (mode === 'off' && env?.MINNOW_SHELL_SANDBOX === '1') {
    return 'prefer';
  }
  return mode;
}

/**
 * Whether the spawn path should attempt a sandbox wrap for this mode.
 * @param {ShellSandboxMode} mode
 * @returns {boolean}
 */
export function modeAttemptsSandbox(mode) {
  return mode === 'prefer' || mode === 'require';
}

/**
 * Actionable error when require cannot apply a sandbox.
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
 * Error when prefer cannot apply and the user has not approved unsandboxed fallback.
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
