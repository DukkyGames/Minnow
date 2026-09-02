/**
 * Shared provisioning helpers for managed servers (venv, pip, downloads).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
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

/** Spawn options for headless pip/ensurepip (no TTY — never block on stdin). */
export function pipSpawnOptions(extra = {}) {
  const { env: extraEnv, ...rest } = extra;
  return {
    windowsHide: true,
    env: { ...process.env, PIP_NO_INPUT: '1', ...extraEnv },
    ...rest,
  };
}

/**
 * Path to the venv interpreter (Scripts/python.exe on Windows).
 * @param {string} venvDir
 * @returns {string}
 */
export function venvPythonExe(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3');
}

/**
 * True when venvDir is a usable virtualenv (pyvenv.cfg + working interpreter).
 * Windows exits 106 with "No pyvenv.cfg file" when Scripts/python.exe exists but cfg is missing.
 * @param {string} venvDir
 * @returns {Promise<boolean>}
 */
export async function isVenvHealthy(venvDir) {
  if (!fs.existsSync(path.join(venvDir, 'pyvenv.cfg'))) {
    return false;
  }
  const python = venvPythonExe(venvDir);
  if (!fs.existsSync(python)) {
    return false;
  }
  try {
    await runProcess(python, ['--version'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
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
 * Remove and recreate the venv when pyvenv.cfg is missing or the interpreter fails.
 * @param {string} pythonExe
 * @param {string} venvDir
 * @param {(message: string) => void} [onProgress]
 * @returns {Promise<'created' | 'repaired' | 'ok'>}
 */
export async function ensureHealthyVenv(pythonExe, venvDir, onProgress) {
  if (await isVenvHealthy(venvDir)) {
    return 'ok';
  }
  if (fs.existsSync(venvDir)) {
    onProgress?.('Repairing corrupted virtual environment');
    await fsp.rm(venvDir, { recursive: true, force: true });
    await createVenv(pythonExe, venvDir);
    return 'repaired';
  }
  onProgress?.('Creating virtual environment');
  await createVenv(pythonExe, venvDir);
  return 'created';
}

/**
 * Install a pip package spec into a venv.
 * Pass spec as one argv entry — shell:true breaks git+ URLs on Windows.
 * @param {string} venvPython
 * @param {string} spec
 * @param {(message: string) => void} [onProgress]
 */
export async function pipInstall(venvPython, spec, onProgress) {
  onProgress?.(`pip install ${spec}`);
  const spawnOpts = pipSpawnOptions();
  await runProcess(venvPython, ['-m', 'ensurepip', '--upgrade'], spawnOpts);
  await runProcess(
    venvPython,
    ['-m', 'pip', 'install', '--upgrade', '--no-input', 'pip', 'wheel'],
    spawnOpts,
  );
  await runProcess(venvPython, ['-m', 'pip', 'install', '--no-input', spec], spawnOpts);
}
