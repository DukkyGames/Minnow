/** @typedef {typeof SANDBOX_UNAVAILABLE_REASON[keyof typeof SANDBOX_UNAVAILABLE_REASON]} SandboxUnavailableReason */

export const SANDBOX_UNAVAILABLE_REASON = Object.freeze({
  PLATFORM_UNSUPPORTED: 'platform_unsupported',
  SEATBELT_UNAVAILABLE: 'seatbelt_unavailable',
  /**
 * @deprecated
 */
  LANDLOCK_NOT_IMPLEMENTED: 'landlock_not_implemented',
  LANDLOCK_HELPER_MISSING: 'landlock_helper_missing',
  LANDLOCK_ABI_UNAVAILABLE: 'landlock_abi_unavailable',
  LANDLOCK_UNAVAILABLE: 'landlock_unavailable',
  WSL_UNAVAILABLE: 'wsl_unavailable',
  DISABLED: 'disabled',
  USER_PTY: 'user_pty',
  NATIVE_WIN_SHELL: 'native_win_shell',
});

/**
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
      return 'minnow-sandbox helper binary not found (build native/minnow-sandbox or set MINNOW_SANDBOX_HELPER; on Windows, package:win ships the Linux ELF and Minnow auto-installs it into WSL at ~/.local/share/minnow/minnow-sandbox)';
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
    case SANDBOX_UNAVAILABLE_REASON.NATIVE_WIN_SHELL:
      return 'Git Bash is a native Windows shell; WSL Landlock does not wrap it. Interactive PTYs are also unsandboxed';
    default:
      return `Agent shell sandbox unavailable (${reason})`;
  }
}
