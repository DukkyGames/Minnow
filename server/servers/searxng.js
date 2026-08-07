/**
 * SearXNG managed server provisioner — standalone Python + venv + settings.yml.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  downloadToFile,
  ensureHealthyVenv,
  extractArchive,
  isVenvHealthy,
  pipSpawnOptions,
  runProcess,
  venvPythonExe,
  verifySha256,
} from './provisioner.js';
import {
  getServerDir,
  getServerMetaPath,
  getServerSettingsPath,
  getServerVenvDir,
  getServersPythonDir,
} from './paths.js';

const SERVER_ID = 'searxng';

/** python-build-standalone release tag (cpython 3.12.x). */
const PYTHON_STANDALONE_RELEASE = '20250205';
const PYTHON_STANDALONE_VERSION = '3.12.9';

/**
 * Official SearXNG from GitHub (PyPI "searxng" is an unrelated MCP wrapper).
 * Installed from a release zip — git+pip fails on Windows (colon paths in the repo).
 */
const SEARXNG_GIT_REF = 'e964708c0';
export const SEARXNG_SOURCE_REF = SEARXNG_GIT_REF;

/**
 * Unix deployment templates in the upstream repo (symlinks + colon gitlink paths).
 * Not needed for pip install; tar extraction fails on Windows without excludes (MIN-158).
 */
export const SEARXNG_ZIP_TAR_EXCLUDES = ['*utils/templates*'];

/**
 * @typedef {object} SearxngInstallStatus
 * @property {boolean} installed
 * @property {string | null} version
 * @property {string | null} pythonVersion
 * @property {number} sizeBytes
 */

/**
 * @param {() => void} [onProgress]
 */
function pythonStandaloneAssetName() {
  const base = `cpython-${PYTHON_STANDALONE_VERSION}+${PYTHON_STANDALONE_RELEASE}`;
  if (process.platform === 'win32') {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    return `${base}-${arch}-pc-windows-msvc-install_only.tar.gz`;
  }
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    return `${base}-${arch}-apple-darwin-install_only.tar.gz`;
  }
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  return `${base}-${arch}-unknown-linux-gnu-install_only.tar.gz`;
}

function pythonStandaloneDownloadUrl(assetName) {
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_RELEASE}/${assetName}`;
}

/** True when a path is the stdlib venv template stub, not a real interpreter. */
export function isVenvTemplatePython(exePath) {
  const normalized = exePath.replace(/\\/g, '/').toLowerCase();
  return (
    normalized.includes('/lib/venv/') ||
    normalized.includes('/lib/venv/scripts/')
  );
}

/** Versioned interpreter filename in python-build-standalone (e.g. python3.12). */
function standalonePythonVersionedBinaryName() {
  const [major, minor] = PYTHON_STANDALONE_VERSION.split('.');
  return `python${major}.${minor}`;
}

/** True when exePath exists on disk and is not a stdlib venv template stub. */
function isStandalonePythonCandidate(exePath) {
  return Boolean(exePath) && fs.existsSync(exePath) && !isVenvTemplatePython(exePath);
}

/**
 * python-build-standalone ships bin/python3 as a symlink. Default fs.cp can leave
 * absolute symlinks into the temp extract dir; after cleanup spawn ENOENT (MIN-432).
 * Re-link bin/python3 and bin/python relative to the versioned interpreter when found.
 * @param {string} runtimeDir
 * @returns {Promise<string | null>}
 */
export async function repairStandalonePythonBinSymlinks(runtimeDir) {
  if (process.platform === 'win32') {
    return null;
  }
  const binDir = path.join(runtimeDir, 'bin');
  if (!fs.existsSync(binDir)) {
    return null;
  }

  const preferred = standalonePythonVersionedBinaryName();
  let versionedName = preferred;
  const preferredPath = path.join(binDir, preferred);
  if (!fs.existsSync(preferredPath)) {
    const entries = await fsp.readdir(binDir);
    const hit = entries.find((name) => /^python3\.\d+(?:\.\d+)?$/.test(name));
    if (!hit || !fs.existsSync(path.join(binDir, hit))) {
      return null;
    }
    versionedName = hit;
  }

  const py3 = path.join(binDir, 'python3');
  const py = path.join(binDir, 'python');
  await fsp.rm(py3, { force: true });
  await fsp.symlink(versionedName, py3);
  await fsp.rm(py, { force: true });
  await fsp.symlink('python3', py);
  return path.join(binDir, versionedName);
}

/**
 * Resolve python.exe / python3 after extracting install_only archive.
 * install_only layouts put the interpreter at the extract root (e.g. runtime/python.exe),
 * not under runtime/python/python.exe — avoid walking into Lib/venv template stubs.
 * @param {string} pythonRoot
 * @returns {Promise<string>}
 */
export async function findStandalonePythonExe(pythonRoot) {
  const versionedBinary = standalonePythonVersionedBinaryName();
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(pythonRoot, 'python.exe'),
          path.join(pythonRoot, 'python', 'python.exe'),
          path.join(pythonRoot, 'python', 'install', 'python.exe'),
        ]
      : [
          path.join(pythonRoot, 'bin', versionedBinary),
          path.join(pythonRoot, 'bin', 'python3'),
          path.join(pythonRoot, 'bin', 'python'),
          path.join(pythonRoot, 'python', 'bin', versionedBinary),
          path.join(pythonRoot, 'python', 'bin', 'python3'),
          path.join(pythonRoot, 'python', 'bin', 'python'),
          path.join(pythonRoot, 'python', 'install', 'bin', versionedBinary),
          path.join(pythonRoot, 'python', 'install', 'bin', 'python3'),
        ];

  for (const candidate of candidates) {
    if (isStandalonePythonCandidate(candidate)) {
      return candidate;
    }
  }

  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'Lib' || ent.name === 'lib') {
          continue;
        }
        const hit = await walk(full);
        if (hit) return hit;
      } else if (
        (ent.name === 'python.exe' ||
          ent.name === 'python3' ||
          ent.name === 'python' ||
          /^python3\.\d+(?:\.\d+)?$/.test(ent.name)) &&
        isStandalonePythonCandidate(full)
      ) {
        return full;
      }
    }
    return null;
  }

  const found = await walk(pythonRoot);
  if (!found) {
    throw new Error('Python executable not found after extracting python-build-standalone');
  }
  return found;
}

/**
 * True when pythonExe is a real interpreter (not a venv template stub).
 * @param {string | null | undefined} exePath
 * @returns {Promise<boolean>}
 */
export async function verifyStandalonePythonExe(exePath) {
  if (!exePath || !fs.existsSync(exePath) || isVenvTemplatePython(exePath)) {
    return false;
  }
  try {
    await runProcess(exePath, ['--version'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} pythonRoot
 * @param {string} pythonExe
 * @param {Record<string, unknown>} [extra]
 */
async function writePythonRuntimeMeta(pythonRoot, pythonExe, extra = {}) {
  const metaPath = path.join(pythonRoot, 'meta.json');
  await fsp.writeFile(
    metaPath,
    `${JSON.stringify(
      {
        release: PYTHON_STANDALONE_RELEASE,
        version: PYTHON_STANDALONE_VERSION,
        pythonExe,
        installedAt: new Date().toISOString(),
        ...extra,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/**
 * @param {(message: string) => void} [onProgress]
 * @returns {Promise<string>} path to standalone python executable
 */
export async function ensureStandalonePython(onProgress) {
  const pythonRoot = getServersPythonDir();
  const runtimeDir = path.join(pythonRoot, 'runtime');
  const metaPath = path.join(pythonRoot, 'meta.json');
  let meta = null;
  try {
    meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
  } catch {
    /* first install */
  }

  if (await verifyStandalonePythonExe(meta?.pythonExe)) {
    return meta.pythonExe;
  }

  // Stale meta from an older installer (e.g. Lib/venv template python.exe) — repair without re-download.
  if (fs.existsSync(runtimeDir)) {
    onProgress?.('Repairing Python runtime');
    try {
      await repairStandalonePythonBinSymlinks(runtimeDir);
      const repaired = await findStandalonePythonExe(runtimeDir);
      if (await verifyStandalonePythonExe(repaired)) {
        await writePythonRuntimeMeta(pythonRoot, repaired, {
          asset: meta?.asset ?? pythonStandaloneAssetName(),
        });
        return repaired;
      }
    } catch {
      /* fall through to full download */
    }
  }

  const assetName = pythonStandaloneAssetName();
  const url = pythonStandaloneDownloadUrl(assetName);
  onProgress?.(`Downloading ${assetName}`);
  await fsp.mkdir(pythonRoot, { recursive: true });

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-python-'));
  const archivePath = path.join(tmpRoot, assetName);
  try {
    await downloadToFile(url, archivePath, () => {});
    const shaUrl = `${url}.sha256`;
    try {
      const shaPath = path.join(tmpRoot, `${assetName}.sha256`);
      await downloadToFile(shaUrl, shaPath);
      const expected = (await fsp.readFile(shaPath, 'utf8')).trim().split(/\s+/)[0];
      if (expected) await verifySha256(archivePath, expected);
    } catch {
      /* checksum file optional */
    }

    const extractDir = path.join(tmpRoot, 'extract');
    await extractArchive(archivePath, extractDir);
    const entries = await fsp.readdir(extractDir, { withFileTypes: true });
    const inner =
      entries.length === 1 && entries[0].isDirectory()
        ? path.join(extractDir, entries[0].name)
        : extractDir;
    const targetDir = path.join(pythonRoot, 'runtime');
    await fsp.rm(targetDir, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(targetDir), { recursive: true });
    // Preserve relative symlinks — default cp can leave absolute links into tmp (MIN-432).
    await fsp.cp(inner, targetDir, { recursive: true, verbatimSymlinks: true });

    await repairStandalonePythonBinSymlinks(targetDir);
    let pythonExe = await findStandalonePythonExe(targetDir);
    if (!(await verifyStandalonePythonExe(pythonExe))) {
      throw new Error('Python runtime install succeeded but interpreter is not runnable');
    }
    await writePythonRuntimeMeta(pythonRoot, pythonExe, { asset: assetName });
    return pythonExe;
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

/** @param {string} venvDir @returns {string} */
function venvPythonPath(venvDir) {
  return venvPythonExe(venvDir);
}

/**
 * Engine overrides merged into upstream defaults (see searx settings_loader.update_settings).
 * Bing is disabled in stock SearXNG but tends to stay up on loopback; brave/ddg/startpage
 * rate-limit automated metasearch and can leave general queries with zero hits.
 */
export const SEARXNG_ENGINE_OVERRIDES_YAML = `
engines:
  - name: bing
    disabled: false
  - name: brave
    disabled: true
  - name: duckduckgo
    disabled: true
  - name: startpage
    disabled: true
`;

/**
 * @param {number} port
 */
export async function writeSearxngSettings(port) {
  const secretKey = randomBytes(32).toString('hex');
  const yaml = `use_default_settings: true

server:
  secret_key: "${secretKey}"
  bind_address: "127.0.0.1"
  port: ${port}
  limiter: false
  public_instance: false

search:
  formats:
    - html
    - json

general:
  debug: false
${SEARXNG_ENGINE_OVERRIDES_YAML}`;
  const settingsPath = getServerSettingsPath(SERVER_ID);
  await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
  await fsp.writeFile(settingsPath, yaml, 'utf8');
}

async function readMeta() {
  try {
    const raw = await fsp.readFile(getServerMetaPath(SERVER_ID), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeMeta(meta) {
  await fsp.mkdir(getServerDir(SERVER_ID), { recursive: true });
  await fsp.writeFile(getServerMetaPath(SERVER_ID), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

/** @returns {string} */
function getSearxngSourceDir() {
  return path.join(getServerDir(SERVER_ID), 'src');
}

/** Marker written when valkeydb.py has been patched for Windows (idempotent). */
const VALKEYDB_WINDOWS_PATCH_MARKER = 'Minnow Windows compatibility patch';

/**
 * SearXNG imports Unix-only `pwd` at module load; patch valkeydb.py on Windows.
 * Upstream does not support Windows (searxng/searxng#5411); limiter is off in our settings.
 * @param {string} valkeydbPath
 * @returns {Promise<boolean>} true when file was patched or already patched
 */
export async function patchValkeydbForWindows(valkeydbPath) {
  if (process.platform !== 'win32') {
    return false;
  }
  let content;
  try {
    content = await fsp.readFile(valkeydbPath, 'utf8');
  } catch {
    return false;
  }
  if (content.includes(VALKEYDB_WINDOWS_PATCH_MARKER)) {
    return true;
  }
  if (!content.includes('import pwd')) {
    return false;
  }

  let patched = content.replace(
    'import os\nimport pwd\nimport logging',
    `import os\nimport getpass\nimport logging\n\n# ${VALKEYDB_WINDOWS_PATCH_MARKER}\ntry:\n    import pwd\nexcept ImportError:\n    pwd = None`,
  );
  patched = patched.replace(
    '        _pw = pwd.getpwuid(os.getuid())\n        logger.exception("[%s (%s)] can\'t connect valkey DB ...", _pw.pw_name, _pw.pw_uid)',
    `        if pwd is not None:\n            _pw = pwd.getpwuid(os.getuid())\n            logger.exception("[%s (%s)] can't connect valkey DB ...", _pw.pw_name, _pw.pw_uid)\n        else:\n            logger.exception("[%s] can't connect valkey DB ...", getpass.getuser())`,
  );
  if (patched === content) {
    throw new Error(`Failed to patch valkeydb.py at ${valkeydbPath}`);
  }
  await fsp.writeFile(valkeydbPath, patched, 'utf8');
  return true;
}

/**
 * @param {string} venvDir
 * @returns {string}
 */
function venvValkeydbPath(venvDir) {
  return path.join(venvDir, 'Lib', 'site-packages', 'searx', 'valkeydb.py');
}

/**
 * Apply Windows-only patches to cached source and installed venv package.
 * @param {{ sourceDir: string, venvDir: string }} paths
 */
async function applyWindowsCompatibilityPatches({ sourceDir, venvDir }) {
  if (process.platform !== 'win32') {
    return;
  }
  await patchValkeydbForWindows(path.join(sourceDir, 'searx', 'valkeydb.py'));
  await patchValkeydbForWindows(venvValkeydbPath(venvDir));
}

/**
 * Download SearXNG sources and pip-install into the venv (Windows-safe zip path).
 * @param {string} venvPython
 * @param {(message: string) => void} [onProgress]
 */
async function installSearxngFromSource(venvPython, onProgress) {
  const progress = (msg) => onProgress?.(msg);
  const sourceDir = getSearxngSourceDir();
  const meta = await readMeta();
  const hasSource =
    meta?.searxngRef === SEARXNG_GIT_REF &&
    fs.existsSync(path.join(sourceDir, 'requirements.txt'));

  if (!hasSource) {
    progress(`Downloading SearXNG (${SEARXNG_GIT_REF})`);
    const zipUrl = `https://github.com/searxng/searxng/archive/${SEARXNG_GIT_REF}.zip`;
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-searxng-'));
    const archivePath = path.join(tmpRoot, `searxng-${SEARXNG_GIT_REF}.zip`);
    try {
      await downloadToFile(zipUrl, archivePath);
      const extractDir = path.join(tmpRoot, 'extract');
      await extractArchive(archivePath, extractDir, { exclude: SEARXNG_ZIP_TAR_EXCLUDES });
      const entries = await fsp.readdir(extractDir);
      const inner =
        entries.length === 1 && entries[0]
          ? path.join(extractDir, entries[0])
          : extractDir;
      await fsp.rm(sourceDir, { recursive: true, force: true });
      await fsp.mkdir(path.dirname(sourceDir), { recursive: true });
      await fsp.cp(inner, sourceDir, { recursive: true });
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  } else {
    progress('Using cached SearXNG source');
  }

  if (process.platform === 'win32') {
    progress('Applying Windows compatibility patches');
  }
  await applyWindowsCompatibilityPatches({
    sourceDir,
    venvDir: getServerVenvDir(SERVER_ID),
  });

  progress('Installing Python dependencies');
  const pipOpts = pipSpawnOptions();
  await runProcess(venvPython, ['-m', 'ensurepip', '--upgrade'], pipOpts);
  await runProcess(
    venvPython,
    ['-m', 'pip', 'install', '--upgrade', '--no-input', 'pip', 'wheel', 'setuptools'],
    pipOpts,
  );
  await runProcess(
    venvPython,
    ['-m', 'pip', 'install', '--no-input', '-r', path.join(sourceDir, 'requirements.txt')],
    pipOpts,
  );
  progress('Installing SearXNG package');
  await runProcess(
    venvPython,
    ['-m', 'pip', 'install', '--no-input', '--no-build-isolation', sourceDir],
    pipOpts,
  );

  await applyWindowsCompatibilityPatches({
    sourceDir,
    venvDir: getServerVenvDir(SERVER_ID),
  });
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
      if (ent.isDirectory()) await walk(full);
      else if (ent.isFile()) {
        const st = await fsp.stat(full);
        total += st.size;
      }
    }
  }
  await walk(root);
  return total;
}

/**
 * @param {(message: string) => void} [onProgress]
 */
export async function provision(onProgress) {
  const progress = (msg) => onProgress?.(msg);
  await fsp.mkdir(getServerDir(SERVER_ID), { recursive: true });

  progress('Ensuring Python runtime');
  const pythonExe = await ensureStandalonePython(progress);

  const venvDir = getServerVenvDir(SERVER_ID);
  await ensureHealthyVenv(pythonExe, venvDir, progress);

  const venvPython = venvPythonPath(venvDir);
  await installSearxngFromSource(venvPython, progress);

  const sizeBytes = await dirSizeBytes(getServerDir(SERVER_ID));
  await writeMeta({
    kind: 'python-venv',
    searxngRef: SEARXNG_GIT_REF,
    version: SEARXNG_GIT_REF,
    pythonVersion: PYTHON_STANDALONE_VERSION,
    sizeBytes,
    installedAt: new Date().toISOString(),
  });

  return { version: SEARXNG_GIT_REF, pythonVersion: PYTHON_STANDALONE_VERSION, sizeBytes };
}

/** @returns {Promise<SearxngInstallStatus>} */
export async function getInstallStatus() {
  const meta = await readMeta();
  const venvDir = getServerVenvDir(SERVER_ID);
  const sourceDir = getSearxngSourceDir();
  const installed =
    (await isVenvHealthy(venvDir)) &&
    fs.existsSync(path.join(sourceDir, 'searx', '__init__.py'));
  if (!installed) {
    return { installed: false, version: null, pythonVersion: null, sizeBytes: 0 };
  }
  const sizeBytes = meta?.sizeBytes ?? (await dirSizeBytes(getServerDir(SERVER_ID)));
  return {
    installed: true,
    version: meta?.version ?? null,
    pythonVersion: meta?.pythonVersion ?? PYTHON_STANDALONE_VERSION,
    sizeBytes,
  };
}

/**
 * @param {number} port
 * @returns {Promise<{ command: string, args: string[], env: Record<string, string>, cwd: string }>}
 */
export async function getSpawnSpec(port) {
  const venvDir = getServerVenvDir(SERVER_ID);
  if (!(await isVenvHealthy(venvDir))) {
    throw new Error(
      'SearXNG virtual environment is corrupted (missing pyvenv.cfg). Reinstall from Settings → Servers.',
    );
  }
  const venvPython = venvPythonPath(venvDir);
  await applyWindowsCompatibilityPatches({
    sourceDir: getSearxngSourceDir(),
    venvDir,
  });
  await writeSearxngSettings(port);
  const settingsPath = getServerSettingsPath(SERVER_ID);
  return {
    command: venvPython,
    args: ['-m', 'searx.webapp'],
    cwd: getServerDir(SERVER_ID),
    env: {
      SEARXNG_SETTINGS_PATH: settingsPath,
      FLASK_ENV: 'production',
    },
  };
}

export async function uninstall() {
  const serverDir = getServerDir(SERVER_ID);
  try {
    await fsp.rm(serverDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return { ok: true };
}
