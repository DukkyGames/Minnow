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

/** Pinned release — update when validating a newer llama.cpp build. */
export const LLAMA_CPP_RELEASE_TAG = 'b9628';

const GITHUB_OWNER = 'ggml-org';
const GITHUB_REPO = 'llama.cpp';
const BINARY_BASE = 'llama-server';

/** @type {Promise<string> | null} */
let installPromise = null;

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
 * Pick the CPU prebuilt asset name for the current platform.
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
 * @param {{ onProgress?: (patch: { percent: number, message: string }) => void }} [opts]
 * @returns {Promise<string>}
 */
export async function ensureLlamaServer(opts = {}) {
  const resolved = await resolveLlamaServer();
  if (resolved.path) return resolved.path;

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
 * @param {{ onProgress?: (patch: { percent: number, message: string }) => void }} opts
 */
async function installManagedLlamaServer(opts) {
  const onProgress = opts.onProgress;
  const tag = LLAMA_CPP_RELEASE_TAG;
  const assetName = pickLlamaReleaseAssetName(tag);
  const releaseUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${tag}`;

  onProgress?.({ percent: 2, message: `Resolving llama.cpp ${tag}` });

  let release;
  try {
    release = await fetchJson(releaseUrl);
  } catch {
    release = await fetchJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    );
  }

  const asset = (release.assets ?? []).find((a) => a.name === assetName);
  if (!asset?.browser_download_url) {
    const names = (release.assets ?? []).map((a) => a.name).join(', ');
    throw new Error(
      `No llama.cpp release asset ${assetName} (available: ${names || 'none'})`,
    );
  }

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-llama-'));
  const managedRoot = getManagedLlamaRoot();

  try {
    const archivePath = path.join(tmpRoot, asset.name);
    onProgress?.({ percent: 5, message: `Downloading ${asset.name}` });
    await downloadToFile(asset.browser_download_url, archivePath, (pct) => {
      onProgress?.({ percent: pct, message: `Downloading ${asset.name}` });
    });

    onProgress?.({ percent: 96, message: 'Extracting llama-server' });
    await fsp.rm(managedRoot, { recursive: true, force: true });
    await fsp.mkdir(managedRoot, { recursive: true });
    const extractDir = path.join(tmpRoot, 'extract');
    await extractArchive(archivePath, extractDir);

    const found = await findExtractedBinary(extractDir);
    if (!found) {
      throw new Error(`llama-server not found inside ${asset.name}`);
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

    const installed = findBinaryInDir(managedRoot);
    if (!installed) {
      throw new Error('llama-server install completed but binary is missing');
    }

    await fsp.writeFile(
      getManagedLlamaMetaPath(),
      `${JSON.stringify(
        {
          version: release.tag_name ?? tag,
          asset: asset.name,
          installedAt: new Date().toISOString(),
          path: installed,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    onProgress?.({ percent: 100, message: 'llama-server ready' });
    return installed;
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
