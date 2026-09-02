/**
 * Best-effort guard: detect and rewrite a leading absolute `cd` that escapes a worktree.
 *
 * Limitation: only the leading-`cd` form is caught.
 * Chained `... && cd /abs && ...` mid-command can still escape worktree isolation.
 */

/**
 * @typedef {{ command: string; redirected: boolean }} GuardResult
 */

/**
 * Check whether `command` opens with an absolute `cd` that lands outside `worktreeRoot`.
 * When it does, rewrite to `cd "<worktreeRoot>" && <remainder>` and return redirected=true.
 * When it doesn't match or the target is already inside the worktree, return the original
 * command unchanged with redirected=false.
 *
 * @param {string} command
 * @param {string} worktreeRoot  Absolute path of the task's worktree (already resolved).
 * @returns {GuardResult}
 */
export function guardCdOutsideWorktree(command, worktreeRoot) {
  if (!worktreeRoot) return { command, redirected: false };

  const leadingAbsCd = /^\s*cd\s+["']?([A-Za-z]:[\\/]|\/)/;
  if (!leadingAbsCd.test(command)) return { command, redirected: false };

  const targetMatch = command.match(/^\s*cd\s+["']?([^\s"';&|]+)/);
  const target = targetMatch?.[1] ?? '';

  const normalizedTarget = target.replace(/\\/g, '/').toLowerCase();
  const normalizedRoot = (worktreeRoot.replace(/\\/g, '/') + '/').toLowerCase();
  if (normalizedTarget.startsWith(normalizedRoot) || normalizedTarget === normalizedRoot.slice(0, -1)) {
    return { command, redirected: false };
  }

  const remainder = command
    .replace(/^\s*cd\s+["']?[^\s"';&|]+["']?\s*/, '')
    .trim();

  const rewritten = remainder
    ? `cd "${worktreeRoot}" && ${remainder}`
    : `cd "${worktreeRoot}"`;

  return { command: rewritten, redirected: true, originalTarget: target };
}
