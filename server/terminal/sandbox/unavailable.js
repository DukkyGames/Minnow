/**
 * Honest reason codes when the agent shell sandbox cannot apply (MIN-553).
 * Callers surface these to the model/UI instead of silently claiming containment.
 */

/** @typedef {typeof SANDBOX_UNAVAILABLE_REASON[keyof typeof SANDBOX_UNAVAILABLE_REASON]} SandboxUnavailableReason */

export const SANDBOX_UNAVAILABLE_REASON = Object.freeze({
  /** Host OS has no sandbox backend (non-darwin/linux/win32, or native Win without WSL path). */
  PLATFORM_UNSUPPORTED: 'platform_unsupported',
  /** `sandbox-exec` missing or probe execution failed on macOS. */
  SEATBELT_UNAVAILABLE: 'seatbelt_unavailable',
  /**
   * @deprecated Phase 5 shipped the helper — prefer LANDLOCK_HELPER_MISSING /
   * LANDLOCK_ABI_UNAVAILABLE / LANDLOCK_UNAVAILABLE. Kept so older tests/logs decode.
   */
  LANDLOCK_NOT_IMPLEMENTED: 'landlock_not_implemented',
  /** `minnow-sandbox` binary not found (dev build missing or package without helper). */
  LANDLOCK_HELPER_MISSING: 'landlock_helper_missing',
  /** Helper ran but kernel Landlock ABI is unavailable (exit 75). */
  LANDLOCK_ABI_UNAVAILABLE: 'landlock_abi_unavailable',
  /** Helper present but probe/apply failed for another reason. */
  LANDLOCK_UNAVAILABLE: 'landlock_unavailable',
  /**
   * Windows: WSL2 missing, no distros, or `wsl.exe` failed — required for Phase 6.
   * Bare WSL without Landlock is still not containment (see LANDLOCK_* reasons).
   */
  WSL_UNAVAILABLE: 'wsl_unavailable',
  /** Sandbox disabled by env / explicit opt-out. */
  DISABLED: 'disabled',
  /** Interactive PTY / user terminal — never sandboxed. */
  USER_PTY: 'user_pty',
});

/**
 * Human-readable detail for a reason code.
 * @param {string} reason
 * @returns {string}
 */
export function describeSandboxUnavailable(reason) {
  switch (reason) {
    case SANDBOX_UNAVAILABLE_REASON.PLATFORM_UNSUPPORTED:
      return 'Agent shell sandbox is not available on this platform (macOS Seatbelt; Linux Landlock; Windows via WSL2+Landlock)';
    case SANDBOX_UNAVAILABLE_REASON.SEATBELT_UNAVAILABLE:
      return 'sandbox-exec is missing or failed its probe';
    case SANDBOX_UNAVAILABLE_REASON.LANDLOCK_NOT_IMPLEMENTED:
      return 'Linux Landlock sandbox helper is not implemented yet (Phase 5)';
    case SANDBOX_UNAVAILABLE_REASON.LANDLOCK_HELPER_MISSING:
      return 'minnow-sandbox helper binary not found (build native/minnow-sandbox or set MINNOW_SANDBOX_HELPER; on Windows the Linux ELF must be on WSL PATH or under a /mnt/… path)';
    case SANDBOX_UNAVAILABLE_REASON.LANDLOCK_ABI_UNAVAILABLE:
      return 'Kernel Landlock ABI unavailable (need Linux 5.13+ with Landlock enabled; on Windows this is checked inside WSL2)';
    case SANDBOX_UNAVAILABLE_REASON.LANDLOCK_UNAVAILABLE:
      return 'minnow-sandbox helper failed its Landlock probe';
    case SANDBOX_UNAVAILABLE_REASON.WSL_UNAVAILABLE:
      return 'Windows agent shell sandbox requires WSL2 (install WSL2 with a distro; bare wsl.exe without Landlock is not containment; native Win sandbox is future work)';
    case SANDBOX_UNAVAILABLE_REASON.DISABLED:
      return 'Agent shell sandbox is disabled';
    case SANDBOX_UNAVAILABLE_REASON.USER_PTY:
      return 'Interactive user PTY sessions are never sandboxed';
    default:
      return `Agent shell sandbox unavailable (${reason})`;
  }
}
