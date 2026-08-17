/**
 * Resolve and install the bundled llama-server binary (ggml-org/llama.cpp releases).
 * Search order: system PATH → app vendor dir → ~/.minnow/models-runtime/llama-cpp.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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

/** Pinned release — Qwen3.8 GGUF arch `qwen35` needs ggml-org b10430 or newer. */
export const LLAMA_CPP_RELEASE_TAG = 'b10448';

const GITHUB_OWNER = 'ggml-org';
const GITHUB_REPO = 'llama.cpp';
const BINARY_BASE = 'llama-server';

/** @type {Promise<string> | null} */
let installPromise = null;

/**
 * `llama-server --help` thinking-budget probe, keyed by binary path.
 * Same path after a managed reinstall would otherwise keep a stale answer.
 * @type {Map<string, Promise<boolean>>}
 */
const thinkingBudgetSupportCache = new Map();

/**
 * @typedef {{ phase: 'idle' | 'installing' | 'completed' | 'failed', percent: number, message: string, error: string | null }} LlamaInstallJob
 */

/** @type {LlamaInstallJob | null} */
let installJob = null;

/** @type {Set<(job: LlamaInstallJob) => void>} */
const installListeners = new Set();

/** Avoid flooding SSE while llama.cpp release archives stream in. */
const LLAMA_INSTALL_EMIT_MS = 200;
let lastInstallEmitAt = 0;

function emitInstallJob() {
  if (!installJob) return;
  const now = Date.now();
  if (installJob.phase === 'installing' && now - lastInstallEmitAt < LLAMA_INSTALL_EMIT_MS) {
    return;
  }
  lastInstallEmitAt = now;
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
 * Compare ggml-org llama.cpp release tags.
 * `b9628` vs `b10448` strip a leading `b` and compare as integers when both
 * parse; otherwise fall back to string equality (pre-release / odd tags).
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
export function llamaReleaseTagsEqual(a, b) {
  if (a == null || b == null) return false;
  const left = normalizeLlamaReleaseTag(String(a));
  const right = normalizeLlamaReleaseTag(String(b));
  if (left.build != null && right.build != null) return left.build === right.build;
  return left.raw === right.raw;
}

/**
 * @param {string} tag
 * @returns {{ raw: string, build: number | null }}
 */
function normalizeLlamaReleaseTag(tag) {
  const raw = tag.trim();
  const stripped = raw.replace(/^b/i, '');
  // Require the whole remainder to be digits so `b10448-rc` does not collide with `b10448`.
  if (/^\d+$/.test(stripped)) {
    return { raw, build: Number.parseInt(stripped, 10) };
  }
  return { raw, build: null };
}

/**
 * Managed-install metadata, or null when the file is missing / invalid.
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readManagedLlamaMeta() {
  try {
    const meta = JSON.parse(await fsp.readFile(getManagedLlamaMetaPath(), 'utf8'));
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Read installed variant from meta.json when present.
 * @returns {Promise<string | null>}
 */
export async function getInstalledLlamaVariant() {
  const meta = await readManagedLlamaMeta();
  return typeof meta?.variant === 'string' ? meta.variant : null;
}

/**
 * Runtime status for GET /api/models/llama-runtime.
 */
export async function getLlamaRuntimeStatus() {
  const resolved = await resolveLlamaServer();
  const meta = await readManagedLlamaMeta();
  const installedVersion = typeof meta?.version === 'string' ? meta.version : null;
  const pinnedVersion = LLAMA_CPP_RELEASE_TAG;
  // Offer upgrade only for a managed tree we actually installed — PATH/vendor
  // binaries are not something Settings can replace with the pin.
  const managedInstallExists = Boolean(findBinaryInDir(getManagedLlamaRoot()));
  const upgradeAvailable =
    managedInstallExists &&
    installedVersion != null &&
    !llamaReleaseTagsEqual(installedVersion, pinnedVersion);

  const assets = await fetchReleaseAssetList();
  const installableVariants = listInstallableVariants(assets);
  const preferredVariant = await detectPreferredLlamaVariant(undefined, assets);
  const config = await readLlamaCppConfig();
  const variant =
    (typeof config.variant === 'string' ? config.variant : null) ??
    (typeof meta?.variant === 'string' ? meta.variant : null) ??
    preferredVariant;

  return {
    path: resolved.path,
    source: resolved.source,
    variant: (typeof meta?.variant === 'string' ? meta.variant : null) ?? (resolved.path ? variant : preferredVariant),
    // Prefer the installed tag when known so callers do not treat the pin as what is on disk.
    version: installedVersion ?? pinnedVersion,
    pinnedVersion,
    installedVersion,
    upgradeAvailable,
    assetNames: Array.isArray(meta?.assetNames) ? meta.assetNames : [],
    installedAt: typeof meta?.installedAt === 'string' ? meta.installedAt : null,
    installable: isLlamaRuntimeInstallable(),
    gpuCapable: isGpuCapableVariant(
      (typeof meta?.variant === 'string' ? meta.variant : null) ?? preferredVariant,
    ),
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
 * sha256 a file without loading the whole zip into RAM.
 * @param {string} filePath
 */
async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Compare sha256 of a downloaded GitHub release archive to the asset `digest`.
 * Fail closed when a digest is present — extracting a corrupted zip has already
 * cost a 20 GB model load later. Skip when the API object omitted digest so
 * older GitHub snapshots / test fixtures still install.
 *
 * @param {string | Buffer | Uint8Array} filePathOrBuffer
 * @param {string | null | undefined} digest  e.g. `sha256:abc…`
 */
export async function assertArchiveDigest(filePathOrBuffer, digest) {
  const raw = typeof digest === 'string' ? digest.trim() : '';
  if (!raw) {
    // GitHub added `digest` on release assets recently; older API responses omit it.
    return;
  }
  const expected = raw.replace(/^sha256:/i, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(`Unrecognized llama.cpp archive digest: ${raw}`);
  }
  const actual =
    typeof filePathOrBuffer === 'string'
      ? await sha256File(filePathOrBuffer)
      : crypto.createHash('sha256').update(filePathOrBuffer).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `llama.cpp archive sha256 mismatch (expected ${expected}, got ${actual}) — not extracting`,
    );
  }
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
 * Copy all files from an extracted archive into the managed install root (flat).
 * Used for Windows cudart companion zips — they ship CUDA DLLs only, no llama-server.
 * @param {string} extractDir
 * @param {string} managedRoot
 */
export async function copyFlattenedExtractContents(extractDir, managedRoot) {
  await fsp.mkdir(managedRoot, { recursive: true });

  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else {
        await fsp.copyFile(full, path.join(managedRoot, ent.name));
      }
    }
  }

  await walk(extractDir);
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
    const variantOk = !wantsVariant || wantsVariant === installedVariant;
    if (variantOk) {
      // Compare against the pin so drift is detected here, but never download
      // during a normal load — Settings offers Upgrade via upgradeAvailable.
      const meta = await readManagedLlamaMeta();
      const installedVersion = typeof meta?.version === 'string' ? meta.version : null;
      const pinnedVersion = opts.tag ?? LLAMA_CPP_RELEASE_TAG;
      const versionDrift =
        Boolean(installedVersion) && !llamaReleaseTagsEqual(installedVersion, pinnedVersion);
      if (versionDrift) {
        return resolved.path;
      }
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
    await assertArchiveDigest(mainArchivePath, mainAsset.digest);

    if (companionZip) {
      const companionAsset = assetByName.get(companionZip);
      if (companionAsset?.browser_download_url) {
        onProgress({ percent: 50, message: `Downloading ${companionZip}` });
        const companionPath = path.join(tmpRoot, companionZip);
        await downloadToFile(companionAsset.browser_download_url, companionPath);
        await assertArchiveDigest(companionPath, companionAsset.digest);
        onProgress({ percent: 70, message: 'Extracting CUDA runtime' });
        const companionExtract = path.join(tmpRoot, 'companion');
        await extractArchive(companionPath, companionExtract);
        await fsp.rm(managedRoot, { recursive: true, force: true });
        await fsp.mkdir(managedRoot, { recursive: true });
        await copyFlattenedExtractContents(companionExtract, managedRoot);
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

    // Same managed path after a reinstall would otherwise keep the old --help probe.
    thinkingBudgetSupportCache.clear();

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

/** Test helper — clear in-flight install lock and the --help probe cache. */
export function resetLlamaRuntimeInstallForTests() {
  installPromise = null;
  thinkingBudgetSupportCache.clear();
}

/**
 * Feature-detect per-request reasoning budget support via `llama-server --help`.
 * Memoized per binary path so a successful load does not respawn --help.
 * @param {string} binaryPath
 * @returns {Promise<boolean>}
 */
export async function detectLlamaThinkingBudgetSupport(binaryPath) {
  if (!binaryPath) return false;
  const cached = thinkingBudgetSupportCache.get(binaryPath);
  if (cached) return cached;

  const probe = (async () => {
    try {
      const result = await runProcess(binaryPath, ['--help'], { timeout: 15_000 });
      const helpText = `${result.stdout}\n${result.stderr}`;
      return /--reasoning-budget/.test(helpText);
    } catch {
      return false;
    }
  })();
  thinkingBudgetSupportCache.set(binaryPath, probe);
  return probe;
}
