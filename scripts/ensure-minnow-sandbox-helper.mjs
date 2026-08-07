/**
 * Ensure the Linux ELF `native/minnow-sandbox/minnow-sandbox` exists for packaging.
 *
 * MIN-553: Windows NSIS ships the same Landlock helper as Linux AppImage (copied
 * into WSL on first use). Never publish an empty/missing resource — fail loudly.
 *
 * - Linux host: run `native/minnow-sandbox/build.sh`
 * - Windows host: build via WSL (`wsl … bash …/build.sh`), binary lands on the
 *   Windows-visible mount (repo path under `/mnt/…`)
 * - Other hosts: require a prebuilt ELF (CI artifact / prior Linux build)
 *
 * Env:
 *   MINNOW_FORCE_SANDBOX_REBUILD=1 — rebuild even when the binary already exists
 *   MINNOW_SKIP_SANDBOX_HELPER=1   — skip only when the binary is already present
 *                                    (still fails if missing; packaging must not ship empty)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowsPathToWslPath } from '../server/terminal/wsl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HELPER_REL = path.join('native', 'minnow-sandbox', 'minnow-sandbox');
const HELPER_ABS = path.join(PROJECT_ROOT, HELPER_REL);
const BUILD_SH_REL = path.join('native', 'minnow-sandbox', 'build.sh');

/**
 * @param {string} message
 */
function log(message) {
  console.log(`[ensure-minnow-sandbox] ${message}`);
}

/**
 * @param {string} message
 */
function fail(message) {
  console.error(`[ensure-minnow-sandbox] ERROR: ${message}`);
  process.exit(1);
}

/**
 * True when the helper file exists and is non-empty (never treat 0-byte as ok).
 * @param {string} [filePath]
 * @returns {boolean}
 */
export function isHelperBinaryPresent(filePath = HELPER_ABS) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/**
 * Run the in-tree build.sh on a native Linux host.
 * @returns {number} exit status
 */
function buildOnLinux() {
  log(`building via bash ${BUILD_SH_REL}`);
  const result = spawnSync('bash', [BUILD_SH_REL], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  return result.status ?? 1;
}

/**
 * Build the ELF inside WSL so the Windows tree gets a real Linux binary.
 * Strips CR from the build script before exec — Git on Windows often checks
 * out shell scripts as CRLF, which breaks `set -o pipefail` inside WSL.
 * @returns {number} exit status
 */
function buildViaWsl() {
  const wslRoot = windowsPathToWslPath(PROJECT_ROOT);
  if (!wslRoot.startsWith('/mnt/')) {
    fail(
      `cannot map project root to a WSL mount path (got ${JSON.stringify(wslRoot)}). ` +
        'Open the repo from a drive WSL can see, or build the helper on Linux and copy it to ' +
        HELPER_REL,
    );
  }

  const buildShPosix = BUILD_SH_REL.replace(/\\/g, '/');
  // Use wsl --cd so the build runs in the repo without relying on Windows→Linux env
  // passthrough (WSL drops env vars unless listed in WSLENV).
  log(`building via WSL --cd ${wslRoot}`);
  const sedResult = spawnSync(
    'wsl.exe',
    ['--cd', wslRoot, '--', 'sed', '-i', 's/\\r$//', buildShPosix],
    {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    },
  );
  if (sedResult.error) {
    fail(
      `WSL build failed to start (${sedResult.error.message}). ` +
        'Install WSL2 with a distro, or place a prebuilt Linux ELF at ' +
        HELPER_REL,
    );
  }
  const result = spawnSync(
    'wsl.exe',
    ['--cd', wslRoot, '--', '/bin/bash', buildShPosix],
    {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    },
  );

  if (result.error) {
    fail(
      `WSL build failed to start (${result.error.message}). ` +
        'Install WSL2 with a distro, or place a prebuilt Linux ELF at ' +
        HELPER_REL,
    );
  }
  return result.status ?? 1;
}

/**
 * Ensure the helper binary is present; build when needed.
 * @param {{ force?: boolean, platform?: NodeJS.Platform }} [opts]
 * @returns {{ path: string, built: boolean }}
 */
export function ensureMinnowSandboxHelper(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const force = opts.force === true || process.env.MINNOW_FORCE_SANDBOX_REBUILD === '1';
  const skipBuild = process.env.MINNOW_SKIP_SANDBOX_HELPER === '1';

  if (!force && isHelperBinaryPresent(HELPER_ABS)) {
    log(`ok: ${HELPER_REL} (${fs.statSync(HELPER_ABS).size} bytes)`);
    return { path: HELPER_ABS, built: false };
  }

  if (skipBuild) {
    if (isHelperBinaryPresent(HELPER_ABS)) {
      log(`ok (skip build): ${HELPER_REL}`);
      return { path: HELPER_ABS, built: false };
    }
    fail(
      `MINNOW_SKIP_SANDBOX_HELPER=1 but ${HELPER_REL} is missing or empty. ` +
        'Build on Linux / via WSL, or unset the skip flag.',
    );
  }

  let status;
  if (platform === 'linux') {
    status = buildOnLinux();
  } else if (platform === 'win32') {
    status = buildViaWsl();
  } else {
    fail(
      `${HELPER_REL} is missing and this host (${platform}) cannot build the Linux ELF. ` +
        'Build on Linux CI (`npm run sandbox:build-helper`), download the CI artifact, ' +
        'or set MINNOW_SANDBOX_HELPER at runtime. Windows packaging must run ensure on a ' +
        'machine with WSL2.',
    );
  }

  if (status !== 0) {
    fail(`helper build exited ${status}`);
  }

  if (!isHelperBinaryPresent(HELPER_ABS)) {
    fail(
      `${HELPER_REL} is still missing or empty after build. ` +
        'Refusing to package a silent empty resource.',
    );
  }

  log(`built: ${HELPER_REL} (${fs.statSync(HELPER_ABS).size} bytes)`);
  return { path: HELPER_ABS, built: true };
}

function main() {
  ensureMinnowSandboxHelper();
}

// Allow `node scripts/ensure-minnow-sandbox-helper.mjs` and programmatic import.
const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main();
}
