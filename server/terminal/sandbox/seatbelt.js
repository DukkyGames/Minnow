import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CREDENTIAL_DENY_ENTRIES } from './policy.js';
import { SANDBOX_UNAVAILABLE_REASON } from './unavailable.js';

export const SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';

/**
 * @param {string} value
 * @returns {string}
 */
export function seatbeltEscape(value) {
  return String(value)
    .replace(/\\/g, '/')
    .replace(/"/g, '\\"');
}

/**
 * @param {string[]} paths
 * @param {'subpath'|'literal'} kind
 * @returns {string[]}
 */
function pathFilters(paths, kind) {
  const seen = new Set();
  const parts = [];
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    parts.push(`(${kind} "${seatbeltEscape(p)}")`);
  }
  return parts;
}

/**
 * @param {string[]} denyReadRoots
 * @param {string} [home]
 * @returns {{ dirs: string[], files: string[] }}
 */
export function partitionDenyReadPaths(denyReadRoots, home = '') {
  /** @type {Set<string>} */
  const fileAbs = new Set();
  if (home) {
    for (const entry of CREDENTIAL_DENY_ENTRIES) {
      if (entry.file) {
        fileAbs.add(path.resolve(home, entry.rel));
      }
    }
  }

  const dirs = [];
  const files = [];
  for (const p of denyReadRoots) {
    if (!p) continue;
    if (fileAbs.has(p) || fileAbs.has(path.resolve(p))) {
      files.push(p);
      continue;
    }
    const base = path.basename(p);
    if (base === 'config.json' || base === '.npmrc' || base === '.pypirc') {
      files.push(p);
      continue;
    }
    dirs.push(p);
  }
  return { dirs, files };
}

/**
 * @param {import('./policy.js').SandboxPolicy} policy
 * @returns {string}
 */
export function renderSeatbeltProfile(policy) {
  const writeNotFilters = pathFilters(policy.writeRoots, 'subpath')
    .map((f) => `(require-not ${f})`)
    .join('\n    ');

  const { dirs: denyDirs, files: denyFiles } = partitionDenyReadPaths(
    policy.denyReadRoots,
    policy.home,
  );
  const denyDirFilters = pathFilters(denyDirs, 'subpath').join('\n  ');
  const denyFileFilters = pathFilters(denyFiles, 'literal').join('\n  ');
  const allowExceptionFilters = pathFilters(policy.allowReadExceptions, 'subpath').join(
    '\n  ',
  );

  const networkRule = policy.networkAllow
    ? '; Network unrestricted in workspace profile (Phase 1 — no proxy/host filter)\n(allow network*)'
    : '; Strict profile: deny all network\n(deny network*)';

  return `(version 1)
(allow default)

; --- write containment (workspace / worktree / temp / caches) ---
(deny file-write*
  (require-all
    ${writeNotFilters}
  )
)

; Device nodes that are not under writeRoots but must stay writable
(allow file-write-data
  (literal "/dev/null")
  (literal "/dev/zero")
  (literal "/dev/dtracehelper")
  (literal "/dev/tty")
)
(allow file-ioctl
  (literal "/dev/dtracehelper")
)

; --- deny-read: ~/.minnow + host credentials ---
${denyDirFilters ? `(deny file-read*\n  ${denyDirFilters}\n)` : '; (no directory deny-read roots)'}
${denyFileFilters ? `(deny file-read*\n  ${denyFileFilters}\n)` : ''}

; Re-allow active worktree slot + terminal logs under the denied ~/.minnow tree
${
  allowExceptionFilters
    ? `(allow file-read*\n  ${allowExceptionFilters}\n)
(allow file-write*\n  ${allowExceptionFilters}\n)`
    : '; (no read exceptions)'
}

${networkRule}
`;
}

/**
 * @param {{ command: string, args?: string[], shell?: boolean, cwd?: string, env?: NodeJS.ProcessEnv }} spawnTarget
 * @param {import('./policy.js').SandboxPolicy} policy
 * @returns {{ command: string, args: string[], shell: boolean, cwd?: string, env?: NodeJS.ProcessEnv }}
 */
export function wrapWithSeatbelt(spawnTarget, policy) {
  const profile = renderSeatbeltProfile(policy);
  const innerArgs = Array.isArray(spawnTarget.args) ? spawnTarget.args : [];
  return {
    command: SANDBOX_EXEC_PATH,
    args: ['-p', profile, spawnTarget.command, ...innerArgs],
    shell: false,
    ...(spawnTarget.cwd != null ? { cwd: spawnTarget.cwd } : {}),
    ...(spawnTarget.env != null ? { env: spawnTarget.env } : {}),
  };
}

/**
 * @returns {{ ok: boolean, reason?: string, detail?: string }}
 */
export function probeSeatbelt() {
  if (!fs.existsSync(SANDBOX_EXEC_PATH)) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.SEATBELT_UNAVAILABLE,
      detail: `${SANDBOX_EXEC_PATH} not found`,
    };
  }
  const result = spawnSync(
    SANDBOX_EXEC_PATH,
    ['-p', '(version 1)(allow default)', '/usr/bin/true'],
    { encoding: 'utf8', timeout: 5_000 },
  );
  if (result.error) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.SEATBELT_UNAVAILABLE,
      detail: result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: SANDBOX_UNAVAILABLE_REASON.SEATBELT_UNAVAILABLE,
      detail: `sandbox-exec probe exit ${result.status}: ${(result.stderr || '').trim()}`,
    };
  }
  return { ok: true };
}

/**
 * @returns {import('./index.js').SandboxAdapter}
 */
export function createSeatbeltAdapter() {
  return {
    kind: 'seatbelt',
    probe: async () => probeSeatbelt(),
    wrap: (spawnTarget, policy) => wrapWithSeatbelt(spawnTarget, policy),
  };
}
