/**
 * Shared provisioning helpers for managed servers (venv, pip, downloads).
 */

import {
  downloadToFile,
  extractArchive,
  npmSpawnOptions,
  resetLspBundleSpawnOverride,
  runProcess,
  setLspBundleSpawnForTests,
  verifySha256,
} from '../lsp/bundle-installer.js';

export {
  downloadToFile,
  extractArchive,
  verifySha256,
  runProcess,
  npmSpawnOptions,
};

/** Replace spawn for unit tests (restored via resetSpawnOverrideForTests). */
export function setSpawnOverrideForTests(fn) {
  setLspBundleSpawnForTests(fn);
}

export function resetSpawnOverrideForTests() {
  resetLspBundleSpawnOverride();
}

/**
 * Create a Python venv with the given interpreter.
 * @param {string} pythonExe
 * @param {string} venvDir
 */
export async function createVenv(pythonExe, venvDir) {
  await runProcess(pythonExe, ['-m', 'venv', '--without-pip', venvDir], {
    windowsHide: true,
  });
}

/**
 * Install a pip package spec into a venv.
 * @param {string} venvPython
 * @param {string} spec
 * @param {(message: string) => void} [onProgress]
 */
export async function pipInstall(venvPython, spec, onProgress) {
  onProgress?.(`pip install ${spec}`);
  const spawnOpts = { windowsHide: true };
  await runProcess(venvPython, ['-m', 'ensurepip', '--upgrade'], spawnOpts);
  await runProcess(
    venvPython,
    ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel'],
    spawnOpts,
  );
  // Pass spec as a single argv entry — shell:true breaks git+ URLs on Windows (@).
  await runProcess(venvPython, ['-m', 'pip', 'install', spec], spawnOpts);
}
