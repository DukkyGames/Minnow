/**
 * Voice Python runtime provisioner — shared standalone Python + venv + ML deps.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createVenv, runProcess } from '../servers/provisioner.js';
import { ensureStandalonePython } from '../servers/searxng.js';
import { getVoiceMetaPath, getVoiceRoot, getVoiceVenvDir } from './paths.js';

/** Pip packages for Phase 2 skeleton (CPU torch is fine until Phase 3/4). */
const CORE_PACKAGES = [
  {
    label: 'torch (CPU)',
    args: [
      'torch',
      '--index-url',
      'https://download.pytorch.org/whl/cpu',
    ],
  },
  { label: 'transformers', args: ['transformers'] },
  { label: 'accelerate', args: ['accelerate'] },
  { label: 'soundfile', args: ['soundfile'] },
];

/** Optional package — install continues when unavailable (CI / platform quirks). */
const OPTIONAL_PACKAGES = [{ label: 'qwen-tts', args: ['qwen-tts'] }];

/**
 * @param {string} venvDir
 * @returns {string}
 */
function venvPythonPath(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3');
}

async function readMeta() {
  try {
    const raw = await fsp.readFile(getVoiceMetaPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} meta
 */
async function writeMeta(meta) {
  await fsp.mkdir(getVoiceRoot(), { recursive: true });
  await fsp.writeFile(getVoiceMetaPath(), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

/**
 * Upgrade pip tooling inside the voice venv.
 * @param {string} venvPython
 * @param {(message: string) => void} [onProgress]
 */
async function ensurePip(venvPython, onProgress) {
  onProgress?.('Upgrading pip');
  await runProcess(venvPython, ['-m', 'ensurepip', '--upgrade'], { windowsHide: true });
  await runProcess(
    venvPython,
    ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel', 'setuptools'],
    { windowsHide: true },
  );
}

/**
 * Install one pip package spec; optional packages log a warning instead of failing.
 * @param {string} venvPython
 * @param {{ label: string, args: string[], optional?: boolean }} pkg
 * @param {(message: string) => void} [onProgress]
 */
async function pipInstallPackage(venvPython, pkg, onProgress) {
  onProgress?.(`Installing ${pkg.label}`);
  try {
    await runProcess(
      venvPython,
      ['-m', 'pip', 'install', ...pkg.args],
      { windowsHide: true },
    );
  } catch (err) {
    if (pkg.optional) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress?.(`Skipped optional ${pkg.label}: ${message}`);
      return false;
    }
    throw err;
  }
  return true;
}

/**
 * @param {(message: string) => void} [onProgress]
 */
export async function provision(onProgress) {
  const progress = (msg) => onProgress?.(msg);
  await fsp.mkdir(getVoiceRoot(), { recursive: true });

  progress('Ensuring Python runtime');
  const pythonExe = await ensureStandalonePython(progress);

  const venvDir = getVoiceVenvDir();
  const venvPython = venvPythonPath(venvDir);
  if (!fs.existsSync(venvPython)) {
    progress('Creating virtual environment');
    await createVenv(pythonExe, venvDir);
  }

  await ensurePip(venvPython, progress);

  const installedPackages = [];
  const skippedPackages = [];

  for (const pkg of CORE_PACKAGES) {
    const ok = await pipInstallPackage(venvPython, pkg, progress);
    if (ok) installedPackages.push(pkg.label);
  }

  for (const pkg of OPTIONAL_PACKAGES) {
    const ok = await pipInstallPackage(venvPython, { ...pkg, optional: true }, progress);
    if (ok) installedPackages.push(pkg.label);
    else skippedPackages.push(pkg.label);
  }

  const prev = await readMeta();
  const meta = {
    kind: 'python-venv',
    installedAt: new Date().toISOString(),
    pythonExe,
    venvPython,
    installedPackages,
    skippedPackages,
    port: prev?.port ?? null,
    pid: prev?.pid ?? null,
  };
  await writeMeta(meta);
  return meta;
}

/** @returns {Promise<{ installed: boolean, installedAt: string | null, installedPackages: string[], skippedPackages: string[] }>} */
export async function getInstallStatus() {
  const venvPython = venvPythonPath(getVoiceVenvDir());
  const meta = await readMeta();
  const installed = fs.existsSync(venvPython);
  return {
    installed,
    installedAt: meta?.installedAt ?? null,
    installedPackages: Array.isArray(meta?.installedPackages) ? meta.installedPackages : [],
    skippedPackages: Array.isArray(meta?.skippedPackages) ? meta.skippedPackages : [],
  };
}

/**
 * @returns {Promise<string>}
 */
export async function getVenvPython() {
  const venvPython = venvPythonPath(getVoiceVenvDir());
  if (!fs.existsSync(venvPython)) {
    throw new Error('Voice runtime is not installed');
  }
  return venvPython;
}

/**
 * @param {Record<string, unknown>} patch
 */
export async function patchMeta(patch) {
  const prev = (await readMeta()) ?? {};
  await writeMeta({ ...prev, ...patch });
}
