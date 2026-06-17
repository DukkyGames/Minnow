/**
 * Resolve and install the bundled llama-server binary (ggml-org/llama.cpp releases).
 * Search order: system PATH → app vendor dir → ~/.minnow/models-runtime/llama-cpp.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { getMinnowHome } from '../config/home.js';
import { runProcess } from '../process-runner.js';
import { getAppRoot } from '../workspace/root.js';
import { readLlamaCppConfig } from './llama-args.js';
import {
  detectPreferredLlamaVariant,
  fetchReleaseAssetList,
  isGpuCapableVariant,
  listInstallableVariants,
  resolveLlamaAssets,
} from './llama-variant.js';

/** Pinned release — update when validating a newer llama.cpp build. */
export const LLAMA_CPP_RELEASE_TAG = 'b9628';

const GITHUB_OWNER = 'ggml-org';
const GITHUB_REPO = 'llama.cpp';
const BINARY_BASE = 'llama-server';

/** @type {Promise<string> | null} */
let installPromise = null;

/**
 * @typedef {{ phase: 'idle' | 'installing' | 'completed' | 'failed', percent: number, message: string, error: string | null }} LlamaInstallJob
 */

/** @type {LlamaInstallJob | null} */
let installJob = null;

/** @type {Set<(job: LlamaInstallJob) => void>} */
const installListeners = new Set();

function emitInstallJob() {
  if (!installJob) return;
  for (const listener of installListeners) {
    try {
      listener(installJob);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * @param {Partial<LlamaInstallJob>} patch
 */
function setInstallJob(patch) {
  installJob = {
    phase: installJob?.phase ?? 'idle',
    percent: installJob?.percent ?? 0,
    message: installJob?.message ?? '',
    error: installJob?.error ?? null,
    ...patch,
  };
  emitInstallJob();
}

/** @returns {LlamaInstallJob | null} */
export function getLlamaInstallJob() {
  return installJob;
}

/**
 * @param {(job: LlamaInstallJob) => void} listener
 * @returns {() => void}
 */
export function subscribeLlamaInstallProgress(listener) {
  if (installJob) listener(installJob);
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

/** Test helper — clear install progress subscribers and job state. */
export function resetLlamaInstallJobForTests() {
  installJob = null;
  installListeners.clear();
  installPromise = null;
}

/** User-managed llama.cpp install root. */
export function getManagedLlamaRoot() {
  return path.join(getMinnowHome(), 'models-runtime', 'llama-cpp');
}

/** Metadata written after a successful managed install. */
export function getManagedLlamaMetaPath() {
  return path.join(getManagedLlamaRoot(), 'meta.json');
}

/** Shipped-with-app vendor directory (optional; populated by packaging or postinstall). */
export function getVendorLlamaRoot() {
  return path.join(getAppRoot(), 'vendor', 'llama-cpp');
}

function binaryFileName() {
  return process.platform === 'win32' ? `${BINARY_BASE}.exe` : BINARY_BASE;
}

/**
 * @param {string} dir
 * @returns {string | null}
 */
function findBinaryInDir(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const direct = path.join(dir, binaryFileName());
  if (fs.existsSync(direct)) return direct;

  // Release archives may nest binaries one level down.
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const nested = path.join(dir, ent.name, binaryFileName());
    if (fs.existsSync(nested)) return nested;
  }
  return null;
}

/**
 * @param {string} cmd
 */
async function which(cmd) {
  try {
    if (process.platform === 'win32') {
      const { code, stdout } = await runProcess('where', [cmd], { timeout: 3_000 });
      if (code === 0 && stdout.trim()) return stdout.trim().split(/\r?\n/)[0];
      return null;
    }
    const { code, stdout } = await runProcess('which', [cmd], { timeout: 3_000 });
    if (code === 0 && stdout.trim()) return stdout.trim().split(/\r?\n/)[0];
    return null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ path: string | null, source: 'path' | 'vendor' | 'managed' | null }>}
 */
export async function resolveLlamaServer() {
  const pathHit = await which(BINARY_BASE);
  if (pathHit && fs.existsSync(pathHit)) {
    return { path: pathHit, source: 'path' };
  }

  const vendorHit = findBinaryInDir(getVendorLlamaRoot());
  if (vendorHit) {
    return { path: vendorHit, source: 'vendor' };
  }

  const managedHit = findBinaryInDir(getManagedLlamaRoot());
  if (managedHit) {
    return { path: managedHit, source: 'managed' };
  }

  return { path: null, source: null };
}

/** True when this host can auto-download a prebuilt llama.cpp binary. */
export function isLlamaRuntimeInstallable() {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'x64' || arch === 'arm64';
  if (platform === 'darwin') return arch === 'x64' || arch === 'arm64';
  if (platform === 'linux') return arch === 'x64' || arch === 'arm64';
  return false;
}

/**
 * Pick the CPU prebuilt asset name for the current platform (legacy helper).
 * @returns {string}
 */
export function pickLlamaReleaseAssetName(tag = LLAMA_CPP_RELEASE_TAG) {
  const { platform, arch } = process;
  if (platform === 'win32') {
    return arch === 'arm64'
      ? `llama-${tag}-bin-win-cpu-arm64.zip`
      : `llama-${tag}-bin-win-cpu-x64.zip`;
  }
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? `llama-${tag}-bin-macos-arm64.tar.gz`
      : `llama-${tag}-bin-macos-x64.tar.gz`;
  }
  if (platform === 'linux') {
    return arch === 'arm64'
      ? `llama-${tag}-bin-ubuntu-arm64.tar.gz`
      : `llama-${tag}-bin-ubuntu-x64.tar.gz`;
  }
  throw new Error(`Unsupported platform for bundled llama-server: ${platform} ${arch}`);
}

/**
 * Read installed variant from meta.json when present.
 * @returns {Promise<string | null>}
 */
export async function getInstalledLlamaVariant() {
  try {
    const raw = await fsp.readFile(getManagedLlamaMetaPath(), 'utf8');
    const meta = JSON.parse(raw);
    return typeof meta.variant === 'string' ? meta.variant : null;
  } catch {
    return null;
  }
}

/**
 * Runtime status for GET /api/models/llama-runtime.
 */
export async function getLlamaRuntimeStatus() {
  const resolved = await resolveLlamaServer();
  let meta = null;
  try {
    meta = JSON.parse(await fsp.readFile(getManagedLlamaMetaPath(), 'utf8'));
  } catch {
    /* not installed via managed path */
  }

  const assets = await fetchReleaseAssetList();
  const installableVariants = listInstallableVariants(assets);
  const preferredVariant = await detectPreferredLlamaVariant(undefined, assets);
  const config = await readLlamaCppConfig();
  const variant =
    (typeof config.variant === 'string' ? config.variant : null) ??
    meta?.variant ??
    preferredVariant;

  return {
    path: resolved.path,
    source: resolved.source,
    variant: meta?.variant ?? (resolved.path ? variant : preferredVariant),
    version: meta?.version ?? LLAMA_CPP_RELEASE_TAG,
    assetNames: meta?.assetNames ?? [],
    installedAt: meta?.installedAt ?? null,
    installable: isLlamaRuntimeInstallable(),
    gpuCapable: isGpuCapableVariant(meta?.variant ?? preferredVariant),
    preferredVariant,
    installableVariants,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'minnow-llama-runtime' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

/**
 * @param {string} url
 * @param {string} dest
 * @param {(pct: number) => void} [onProgress]
 */
async function downloadToFile(url, dest, onProgress) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'minnow-llama-runtime' },
  });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('content-length') || 0);
  let received = 0;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const file = fs.createWriteStream(dest);
  const body = res.body;
  if (!body) {
    throw new Error('Empty response body');
  }
  for await (const chunk of body) {
    received += chunk.length;
    file.write(chunk);
    if (total > 0 && onProgress) {
      onProgress(Math.min(95, Math.round((received / total) * 90) + 5));
    }
  }
  await new Promise((resolve, reject) => {
    file.end(() => resolve());
    file.on('error', reject);
  });
}

/**
 * @param {string} archivePath
 * @param {string} destDir
 */
async function extractArchive(archivePath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    await runProcess('tar', ['-xf', archivePath, '-C', destDir], { cwd: destDir });
    return;
  }
  if (archivePath.endsWith('.gz') && !archivePath.endsWith('.tar.gz')) {
    const outPath = path.join(destDir, path.basename(archivePath, '.gz'));
    await pipeline(
      fs.createReadStream(archivePath),
      createGunzip(),
      fs.createWriteStream(outPath),
    );
    return;
  }
  await runProcess('tar', ['-xf', archivePath, '-C', destDir]);
}

/**
 * Copy extracted binaries into the managed install root.
 * @param {string} extractDir
 * @param {string} managedRoot
 */
async function copyExtractedBinaries(extractDir, managedRoot) {
  const found = await findExtractedBinary(extractDir);
  if (!found) {
    throw new Error('llama-server not found inside archive');
  }

  const binDir = path.dirname(found);
  const entries = await fsp.readdir(binDir, { withFileTypes: true });
  for (const ent of entries) {
    const src = path.join(binDir, ent.name);
    const dest = path.join(managedRoot, ent.name);
    if (ent.isDirectory()) {
      await fsp.cp(src, dest, { recursive: true });
    } else {
      await fsp.copyFile(src, dest);
      if (process.platform !== 'win32' && ent.name === BINARY_BASE) {
        await fsp.chmod(dest, 0o755);
      }
    }
  }
}

/**
 * @param {string} searchDir
 */
async function findExtractedBinary(searchDir) {
  const wanted = binaryFileName();
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const hit = await walk(full);
        if (hit) return hit;
      } else if (ent.name === wanted || ent.name === BINARY_BASE) {
        return full;
      }
    }
    return null;
  }
  return walk(searchDir);
}

/**
 * Install llama-server into ~/.minnow/models-runtime/llama-cpp when missing.
 * @param {{ variant?: string, tag?: string, reinstall?: boolean, onProgress?: (patch: { percent: number, message: string }) => void }} [opts]
 * @returns {Promise<string>}
 */
export async function ensureLlamaServer(opts = {}) {
  const resolved = await resolveLlamaServer();
  const installedVariant = await getInstalledLlamaVariant();
  const config = await readLlamaCppConfig();
  const wantsVariant = opts.variant ?? config.variant;

  if (resolved.path && !opts.reinstall) {
    if (!wantsVariant || wantsVariant === installedVariant) {
      return resolved.path;
    }
  }

  if (!isLlamaRuntimeInstallable()) {
    throw new Error(
      'llama-server not found — install llama.cpp server binaries or use Ollama/LM Studio',
    );
  }

  if (!installPromise) {
    installPromise = installManagedLlamaServer(opts).finally(() => {
      installPromise = null;
    });
  }
  return installPromise;
}

/**
 * @param {{ variant?: string, tag?: string, reinstall?: boolean, onProgress?: (patch: { percent: number, message: string }) => void }} opts
 */
async function installManagedLlamaServer(opts) {
  const onProgress = (patch) => {
    setInstallJob({
      phase: 'installing',
      percent: patch.percent,
      message: patch.message,
      error: null,
    });
    opts.onProgress?.(patch);
  };
  setInstallJob({ phase: 'installing', percent: 0, message: 'Starting install', error: null });
  const tag = opts.tag ?? LLAMA_CPP_RELEASE_TAG;
  const config = await readLlamaCppConfig();
  const assets = await fetchReleaseAssetList(tag);
  const variant =
    opts.variant ??
    config.variant ??
    (await detectPreferredLlamaVariant(undefined, assets));

  const { mainZip, companionZip, assetNames } = resolveLlamaAssets({
    variant,
    tag,
    assets,
  });

  const releaseUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${tag}`;

  onProgress({ percent: 2, message: `Resolving llama.cpp ${tag} (${variant})` });

  let release;
  try {
    release = await fetchJson(releaseUrl);
  } catch {
    release = await fetchJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    );
  }

  const assetByName = new Map((release.assets ?? []).map((a) => [a.name, a]));
  const mainAsset = assetByName.get(mainZip);
  if (!mainAsset?.browser_download_url) {
    throw new Error(`No llama.cpp release asset ${mainZip}`);
  }

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-llama-'));
  const managedRoot = getManagedLlamaRoot();

  try {
    onProgress({ percent: 5, message: `Downloading ${mainZip}` });
    const mainArchivePath = path.join(tmpRoot, mainZip);
    await downloadToFile(mainAsset.browser_download_url, mainArchivePath, (pct) => {
      onProgress({ percent: pct, message: `Downloading ${mainZip}` });
    });

    if (companionZip) {
      const companionAsset = assetByName.get(companionZip);
      if (companionAsset?.browser_download_url) {
        onProgress({ percent: 50, message: `Downloading ${companionZip}` });
        const companionPath = path.join(tmpRoot, companionZip);
        await downloadToFile(companionAsset.browser_download_url, companionPath);
        onProgress({ percent: 70, message: 'Extracting CUDA runtime' });
        const companionExtract = path.join(tmpRoot, 'companion');
        await extractArchive(companionPath, companionExtract);
        await fsp.rm(managedRoot, { recursive: true, force: true });
        await fsp.mkdir(managedRoot, { recursive: true });
        await copyExtractedBinaries(companionExtract, managedRoot);
      }
    }

    onProgress({ percent: 85, message: 'Extracting llama-server' });
    if (!companionZip) {
      await fsp.rm(managedRoot, { recursive: true, force: true });
      await fsp.mkdir(managedRoot, { recursive: true });
    }
    const extractDir = path.join(tmpRoot, 'extract');
    await extractArchive(mainArchivePath, extractDir);
    await copyExtractedBinaries(extractDir, managedRoot);

    const installed = findBinaryInDir(managedRoot);
    if (!installed) {
      throw new Error('llama-server install completed but binary is missing');
    }

    await fsp.writeFile(
      getManagedLlamaMetaPath(),
      `${JSON.stringify(
        {
          version: release.tag_name ?? tag,
          variant,
          assetNames,
          installedAt: new Date().toISOString(),
          path: installed,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    onProgress({ percent: 100, message: 'llama-server ready' });
    setInstallJob({ phase: 'completed', percent: 100, message: 'llama-server ready', error: null });
    return installed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setInstallJob({ phase: 'failed', percent: 0, message, error: message });
    throw err;
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

/**
 * Working directory for spawning llama-server (DLLs live beside the exe on Windows).
 * @param {string} binaryPath
 */
export function llamaServerSpawnCwd(binaryPath) {
  return path.dirname(binaryPath);
}

/**
 * Merge the llama-server directory ahead of PATH so bundled DLLs resolve on Windows.
 * @param {string} binaryPath
 * @param {NodeJS.ProcessEnv} [baseEnv]
 */
export function buildLlamaServerEnv(binaryPath, baseEnv = process.env) {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const binDir = path.dirname(binaryPath);
  const existing = baseEnv[pathKey] ?? process.env[pathKey] ?? '';
  return {
    ...baseEnv,
    [pathKey]: existing ? `${binDir}${path.delimiter}${existing}` : binDir,
  };
}

/** Test helper — clear in-flight install lock. */
export function resetLlamaRuntimeInstallForTests() {
  installPromise = null;
}
