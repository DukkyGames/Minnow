/**
 * Install language server bundles to ~/.minnow/lsp-servers (npm or GitHub binaries).
 */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { getAppRoot } from '../workspace/root.js';
import {
  getManagedLspBinDir,
  getManagedLspMetaPath,
  getManagedLspNpmRoot,
  getManagedLspRoot,
} from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {'pending'|'downloading'|'installing'|'done'|'error'} BundleJobPhase */

/**
 * @typedef {object} BundleJob
 * @property {string} bundleId
 * @property {BundleJobPhase} phase
 * @property {number} percent
 * @property {string} message
 * @property {string | undefined} error
 */

/** @type {Map<string, BundleJob>} */
const jobs = new Map();

/** @type {import('../../src/lsp/bundles.json') | null} */
let catalogCache = null;

function catalogPath() {
  return path.join(getAppRoot(), 'src', 'lsp', 'bundles.json');
}

/** Load bundles catalog from src/lsp/bundles.json. */
export async function loadBundlesCatalog() {
  if (catalogCache) return catalogCache;
  const raw = await fsp.readFile(catalogPath(), 'utf8');
  catalogCache = JSON.parse(raw);
  return catalogCache;
}

/** @returns {Promise<Array<object>>} */
export async function listAllBundles() {
  const catalog = await loadBundlesCatalog();
  const out = [];
  for (const cat of catalog.categories ?? []) {
    for (const bundle of cat.bundles ?? []) {
      out.push({ ...bundle, categoryId: cat.id, categoryLabel: cat.label });
    }
  }
  return out;
}

/** @param {string} bundleId */
export async function findBundleDefinition(bundleId) {
  const all = await listAllBundles();
  return all.find((b) => b.id === bundleId);
}

async function readMeta(bundleId) {
  try {
    const raw = await fsp.readFile(getManagedLspMetaPath(bundleId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeMeta(bundleId, meta) {
  const metaDir = path.join(getManagedLspRoot(), 'meta');
  await fsp.mkdir(metaDir, { recursive: true });
  await fsp.writeFile(
    getManagedLspMetaPath(bundleId),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  );
}

async function removeMeta(bundleId) {
  try {
    await fsp.unlink(getManagedLspMetaPath(bundleId));
  } catch {
    /* ignore */
  }
}

function updateJob(jobId, patch) {
  const prev = jobs.get(jobId) ?? {
    bundleId: jobId,
    phase: 'pending',
    percent: 0,
    message: '',
  };
  const next = { ...prev, ...patch, bundleId: jobId };
  jobs.set(jobId, next);
  return next;
}

export function getBundleJob(bundleId) {
  return jobs.get(bundleId) ?? null;
}

export function listBundleJobs() {
  return [...jobs.values()];
}

/** @type {typeof spawn | null} */
let spawnOverride = null;

/** Replace spawn for unit tests (restored via resetLspBundleSpawnOverride). */
export function setLspBundleSpawnForTests(fn) {
  spawnOverride = fn;
}

export function resetLspBundleSpawnOverride() {
  spawnOverride = null;
}

export function runProcess(command, args, options = {}) {
  const spawnFn = spawnOverride ?? spawn;
  const { shell = false, ...spawnOpts } = options;
  return new Promise((resolve, reject) => {
    const child = spawnFn(command, args, {
      windowsHide: true,
      ...spawnOpts,
      shell,
    });
    let stdout = '';
    let stderr = '';
    // Drain both streams — pip and other tools write progress to stdout; if it is
    // not consumed the pipe buffer fills and the child blocks indefinitely.
    child.stdout?.on('data', (c) => {
      stdout += String(c);
    });
    child.stderr?.on('data', (c) => {
      stderr += String(c);
    });
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited ${code}`));
    });
  });
}

/** npm on Windows must use shell:true; npm.cmd with shell:false throws spawn EINVAL. */
export function npmSpawnOptions(extra = {}) {
  return {
    shell: process.platform === 'win32',
    ...extra,
  };
}

async function dirSizeBytes(root) {
  let total = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        const st = await fsp.stat(full);
        total += st.size;
      }
    }
  }
  await walk(root);
  return total;
}

/**
 * @param {string} bundleId
 * @param {object} bundle
 */
async function getInstalledNpmStatus(bundleId, bundle) {
  const prefix = getManagedLspNpmRoot();
  const managedPkgDir = path.join(prefix, 'node_modules', bundle.npmPackage);
  const appPkgDir = path.join(getAppRoot(), 'node_modules', bundle.npmPackage);
  const pkgDir = fs.existsSync(managedPkgDir)
    ? managedPkgDir
    : bundle.prebundled && fs.existsSync(appPkgDir)
      ? appPkgDir
      : null;
  const meta = await readMeta(bundleId);
  if (!pkgDir) {
    return { installed: false, version: null, sizeBytes: 0, location: null };
  }
  let version = meta?.version ?? null;
  try {
    const pkgJson = JSON.parse(
      await fsp.readFile(path.join(pkgDir, 'package.json'), 'utf8'),
    );
    version = pkgJson.version ?? version;
  } catch {
    /* ignore */
  }
  const sizeBytes = meta?.sizeBytes ?? (await dirSizeBytes(pkgDir));
  return {
    installed: true,
    version,
    sizeBytes,
    location: pkgDir,
  };
}

/**
 * @param {string} bundleId
 * @param {object} bundle
 */
async function getInstalledBinaryStatus(bundleId, bundle) {
  const binPath = path.join(getManagedLspBinDir(), binaryFileName(bundle.binaryName));
  const meta = await readMeta(bundleId);
  if (!fs.existsSync(binPath)) {
    return { installed: false, version: null, sizeBytes: 0, location: null };
  }
  const st = await fsp.stat(binPath);
  return {
    installed: true,
    version: meta?.version ?? null,
    sizeBytes: meta?.sizeBytes ?? st.size,
    location: binPath,
  };
}

function binaryFileName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

/** @param {string} bundleId */
export async function getBundleInstallStatus(bundleId) {
  const bundle = await findBundleDefinition(bundleId);
  if (!bundle) {
    return { bundleId, found: false, installed: false };
  }
  const job = getBundleJob(bundleId);
  const status =
    bundle.kind === 'npm'
      ? await getInstalledNpmStatus(bundleId, bundle)
      : await getInstalledBinaryStatus(bundleId, bundle);
  return {
    bundleId,
    found: true,
    kind: bundle.kind,
    label: bundle.label,
    prebundled: bundle.prebundled === true,
    ...status,
    job,
  };
}

/** List catalog entries merged with install state. */
export async function listBundlesWithStatus() {
  const catalog = await loadBundlesCatalog();
  const categories = [];
  for (const cat of catalog.categories ?? []) {
    const bundles = [];
    for (const def of cat.bundles ?? []) {
      const status = await getBundleInstallStatus(def.id);
      bundles.push({
        ...def,
        installed: status.installed,
        version: status.version,
        sizeBytes: status.sizeBytes,
        job: status.job,
      });
    }
    categories.push({
      id: cat.id,
      label: cat.label,
      bundles,
    });
  }
  return { categories };
}

/**
 * @param {string} bundleId
 * @param {object} bundle
 */
async function installNpmBundle(bundleId, bundle) {
  const prefix = getManagedLspNpmRoot();
  await fsp.mkdir(prefix, { recursive: true });
  const spec = bundle.npmVersion
    ? `${bundle.npmPackage}@${bundle.npmVersion}`
    : bundle.npmPackage;
  updateJob(bundleId, {
    phase: 'installing',
    percent: 20,
    message: `npm install ${spec}`,
  });
  await runProcess(
    'npm',
    ['install', '--prefix', prefix, '--no-save', '--no-audit', '--no-fund', spec],
    npmSpawnOptions({ cwd: prefix, env: process.env }),
  );
  const status = await getInstalledNpmStatus(bundleId, bundle);
  await writeMeta(bundleId, {
    kind: 'npm',
    package: bundle.npmPackage,
    version: status.version ?? bundle.npmVersion,
    sizeBytes: status.sizeBytes,
    installedAt: new Date().toISOString(),
  });
  return status;
}

function rustAnalyzerTargetTriple() {
  const { platform, arch } = process;
  if (platform === 'win32') {
    return arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
}

/**
 * @param {object} github
 * @returns {string}
 */
function pickGithubAssetName(github, bundleId) {
  const target = rustAnalyzerTargetTriple();
  if (bundleId === 'rust-analyzer') {
    const ext = process.platform === 'win32' ? 'zip' : 'gz';
    return `rust-analyzer-${target}.${ext}`;
  }
  if (bundleId === 'terraform-ls') {
    const osName =
      process.platform === 'win32'
        ? 'windows'
        : process.platform === 'darwin'
          ? 'darwin'
          : 'linux';
    const archName = process.arch === 'arm64' ? 'arm64' : 'amd64';
    return `terraform-ls_${github.version}_${osName}_${archName}.zip`;
  }
  if (bundleId === 'zls') {
    const osName =
      process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
    const archName = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    return `zls-${archName}-${osName}.tar.xz`;
  }
  if (bundleId === 'lua-language-server') {
    const osName =
      process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
    const archName = process.arch === 'arm64' ? 'arm64' : 'x64';
    const ver = String(github?.version ?? '').replace(/^v/, '');
    return `lua-language-server-${ver}-${osName}-${archName}.zip`;
  }
  if (bundleId === 'gopls') {
    return '';
  }
  return `${bundleId}-${target}.zip`;
}

function platformAssetPatterns() {
  const os =
    process.platform === 'win32'
      ? [/windows/i, /\bwin\b/i, /msvc/i]
      : process.platform === 'darwin'
        ? [/darwin/i, /macos/i, /apple/i]
        : [/linux/i];
  const arch =
    process.arch === 'arm64'
      ? [/aarch64/i, /arm64/i]
      : [/amd64/i, /x86_64/i, /\bx64\b/i];
  return { os, arch };
}

function assetMatchesPlatform(name) {
  const lower = name.toLowerCase();
  const { os, arch } = platformAssetPatterns();
  if (!os.some((p) => p.test(lower))) return false;
  if (!arch.some((p) => p.test(lower))) return false;
  if (process.arch !== 'arm64' && /aarch64|arm64/.test(lower)) return false;
  return true;
}

const BUNDLE_ASSET_HINTS = {
  'rust-analyzer': [/rust-analyzer/i],
  gopls: [/gopls/i],
  clangd: [/clangd/i],
  'lua-language-server': [/lua-language-server/i],
  zls: [/\bzls\b/i],
  'terraform-ls': [/terraform-ls/i],
};

/**
 * Pick a release asset by bundle id + platform, with exact-name fallback.
 * @param {Array<{ name: string, browser_download_url?: string }>} assets
 * @param {string} bundleId
 * @param {object} github
 */
function findGithubReleaseAsset(assets, bundleId, github) {
  const list = assets ?? [];
  if (github?.assetName) {
    const exact = list.find((a) => a.name === github.assetName);
    if (exact?.browser_download_url) return exact;
  }

  const hints = BUNDLE_ASSET_HINTS[bundleId] ?? [
    new RegExp(bundleId.replace(/-/g, '[-_.]?'), 'i'),
  ];
  const archive = /\.(zip|tar\.gz|tgz|tar\.xz|gz)$/i;
  const candidates = list.filter(
    (a) => archive.test(a.name) && hints.some((h) => h.test(a.name)),
  );
  const platformMatch = candidates.find((a) => assetMatchesPlatform(a.name));
  if (platformMatch?.browser_download_url) return platformMatch;

  const fallbackName = pickGithubAssetName(github, bundleId);
  return list.find((a) => a.name === fallbackName) ?? candidates[0] ?? null;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'minnow-lsp-bundle-installer' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

export async function downloadToFile(url, dest, onProgress) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'minnow-lsp-bundle-installer' },
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
      onProgress(Math.min(90, Math.round((received / total) * 80) + 10));
    }
  }
  await new Promise((resolve, reject) => {
    file.end(() => resolve());
    file.on('error', reject);
  });
}

export async function verifySha256(filePath, expectedHex) {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  const digest = hash.digest('hex');
  if (digest.toLowerCase() !== expectedHex.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${path.basename(filePath)}`);
  }
}

/** Tar exclude patterns applied to every .zip on Windows (colon paths are invalid on NTFS). */
export const WIN_ZIP_TAR_EXCLUDES = ['*:*'];

/**
 * Build tar argv for archive extraction, including optional exclude globs.
 * @param {string} archivePath
 * @param {string} destDir
 * @param {string[]} excludePatterns
 * @returns {string[]}
 */
export function buildTarExtractArgs(archivePath, destDir, excludePatterns = []) {
  const args = ['-xf', archivePath, '-C', destDir];
  for (const pattern of excludePatterns) {
    if (pattern) args.push(`--exclude=${pattern}`);
  }
  return args;
}

/**
 * @param {string} archivePath
 * @param {string} destDir
 * @param {{ exclude?: string[] }} [options]
 */
export async function extractArchive(archivePath, destDir, options = {}) {
  await fsp.mkdir(destDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    const excludePatterns = [...(options.exclude ?? [])];
    if (process.platform === 'win32') {
      excludePatterns.push(...WIN_ZIP_TAR_EXCLUDES);
    }
    await runProcess('tar', buildTarExtractArgs(archivePath, destDir, excludePatterns), {
      cwd: destDir,
    });
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

async function findExtractedBinary(searchDir, binaryName) {
  const wanted = binaryFileName(binaryName);
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const hit = await walk(full);
        if (hit) return hit;
      } else if (ent.name === wanted || ent.name === binaryName) {
        return full;
      }
    }
    return null;
  }
  return walk(searchDir);
}

/**
 * @param {string} bundleId
 * @param {object} bundle
 */
async function installBinaryBundle(bundleId, bundle) {
  const github = bundle.github;
  if (!github?.owner || !github?.repo) {
    throw new Error(`Binary bundle "${bundleId}" has no GitHub release metadata`);
  }
  const version = github.version;
  const releaseUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/releases/tags/${version}`;
  updateJob(bundleId, {
    phase: 'downloading',
    percent: 5,
    message: `Resolving ${github.owner}/${github.repo} ${version}`,
  });

  let release;
  try {
    release = await fetchJson(releaseUrl);
  } catch {
    const latest = await fetchJson(
      `https://api.github.com/repos/${github.owner}/${github.repo}/releases/latest`,
    );
    release = latest;
  }

  const asset = findGithubReleaseAsset(release.assets ?? [], bundleId, github);
  if (!asset?.browser_download_url) {
    const names = (release.assets ?? []).map((a) => a.name).join(', ');
    throw new Error(
      `No matching release asset for ${bundleId} on ${github.owner}/${github.repo} (tag ${version}). Assets: ${names || 'none'}`,
    );
  }
  const assetName = asset.name;

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-lsp-'));
  const archivePath = path.join(tmpRoot, asset.name);
  try {
    await downloadToFile(asset.browser_download_url, archivePath, (pct) => {
      updateJob(bundleId, { phase: 'downloading', percent: pct, message: `Downloading ${asset.name}` });
    });

    const checksumAsset = (release.assets ?? []).find((a) => a.name === `${asset.name}.sha256`);
    if (checksumAsset?.browser_download_url) {
      const sumPath = `${archivePath}.sha256`;
      await downloadToFile(checksumAsset.browser_download_url, sumPath);
      const expected = (await fsp.readFile(sumPath, 'utf8')).trim().split(/\s+/)[0];
      if (expected) {
        await verifySha256(archivePath, expected);
      }
    }

    const extractDir = path.join(tmpRoot, 'extract');
    await extractArchive(archivePath, extractDir);
    const found = await findExtractedBinary(extractDir, bundle.binaryName);
    if (!found) {
      throw new Error(`Binary ${bundle.binaryName} not found in ${asset.name}`);
    }

    const binDir = getManagedLspBinDir();
    await fsp.mkdir(binDir, { recursive: true });
    const dest = path.join(binDir, binaryFileName(bundle.binaryName));
    await fsp.copyFile(found, dest);
    if (process.platform !== 'win32') {
      await fsp.chmod(dest, 0o755);
    }
    const st = await fsp.stat(dest);
    await writeMeta(bundleId, {
      kind: 'binary',
      binaryName: bundle.binaryName,
      version: release.tag_name ?? version,
      sizeBytes: st.size,
      installedAt: new Date().toISOString(),
      asset: asset.name,
    });
    return {
      installed: true,
      version: release.tag_name ?? version,
      sizeBytes: st.size,
      location: dest,
    };
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

/** Install a bundle (idempotent). */
export async function installBundle(bundleId) {
  const bundle = await findBundleDefinition(bundleId);
  if (!bundle) {
    throw new Error(`Unknown bundle: ${bundleId}`);
  }

  const existing =
    bundle.kind === 'npm'
      ? await getInstalledNpmStatus(bundleId, bundle)
      : await getInstalledBinaryStatus(bundleId, bundle);
  if (existing.installed) {
    updateJob(bundleId, {
      phase: 'done',
      percent: 100,
      message: 'Already installed',
      error: undefined,
    });
    return { ok: true, alreadyInstalled: true, ...existing };
  }

  updateJob(bundleId, { phase: 'pending', percent: 0, message: 'Starting', error: undefined });
  try {
    const result =
      bundle.kind === 'npm'
        ? await installNpmBundle(bundleId, bundle)
        : await installBinaryBundle(bundleId, bundle);
    updateJob(bundleId, { phase: 'done', percent: 100, message: 'Installed' });
    return { ok: true, alreadyInstalled: false, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(bundleId, { phase: 'error', percent: 0, message, error: message });
    throw err;
  }
}

/** Remove a managed bundle install. */
export async function uninstallBundle(bundleId) {
  const bundle = await findBundleDefinition(bundleId);
  if (!bundle) {
    throw new Error(`Unknown bundle: ${bundleId}`);
  }

  if (bundle.kind === 'npm') {
    const prefix = getManagedLspNpmRoot();
    if (fs.existsSync(path.join(prefix, 'node_modules', bundle.npmPackage))) {
      await runProcess(
        'npm',
        ['uninstall', '--prefix', prefix, bundle.npmPackage],
        npmSpawnOptions({ cwd: prefix }),
      );
    }
  } else if (bundle.kind === 'binary') {
    const dest = path.join(getManagedLspBinDir(), binaryFileName(bundle.binaryName));
    try {
      await fsp.unlink(dest);
    } catch {
      /* ignore */
    }
  }

  await removeMeta(bundleId);
  jobs.delete(bundleId);
  return { ok: true };
}

/** Reset catalog cache (tests). */
export function resetBundlesCatalogCache() {
  catalogCache = null;
}
