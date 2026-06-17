/**
 * SearXNG provisioner — settings.yml, spawn spec, install meta.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { ensureMinnowLayout } from '../../server/config/home.js';
import {
  findStandalonePythonExe,
  getInstallStatus,
  getSpawnSpec,
  isVenvTemplatePython,
  patchValkeydbForWindows,
  verifyStandalonePythonExe,
  writeSearxngSettings,
} from '../../server/servers/searxng.js';
import { createVenv } from '../../server/servers/provisioner.js';
import {
  getServerDir,
  getServerMetaPath,
  getServerSettingsPath,
  getServerVenvDir,
} from '../../server/servers/paths.js';

const FIXED_PORT = 9901;

/** @returns {string} */
function venvPythonPath() {
  const venvDir = getServerVenvDir('searxng');
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3');
}

/** Create a real venv for tests that need a working interpreter. */
async function ensureTestVenv() {
  const venvDir = getServerVenvDir('searxng');
  await fsp.rm(venvDir, { recursive: true, force: true });
  const systemPython = process.env.SEARXNG_TEST_PYTHON ?? 'python';
  await createVenv(systemPython, venvDir);
}

describe('searxng provisioner', () => {
  /** @type {string} */
  let tempHome;

  before(async () => {
    tempHome = path.join(os.tmpdir(), 'minnow-searxng-prov-test');
    process.env.MINNOW_HOME = tempHome;
    resetMinnowHomeCache();
    await fsp.rm(tempHome, { recursive: true, force: true });
    await ensureMinnowLayout();
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('verifyStandalonePythonExe rejects venv template stubs', async () => {
    const stub = path.join(tempHome, 'servers', 'python', 'runtime', 'Lib', 'venv', 'scripts', 'nt', 'python.exe');
    await fsp.mkdir(path.dirname(stub), { recursive: true });
    await fsp.writeFile(stub, '', 'utf8');
    assert.equal(await verifyStandalonePythonExe(stub), false);
    assert.equal(await verifyStandalonePythonExe(null), false);
  });

  it('findStandalonePythonExe prefers install_only root python.exe over venv stubs', async () => {
    const runtime = path.join(tempHome, 'servers', 'python', 'runtime');
    const stubDir = path.join(runtime, 'Lib', 'venv', 'scripts', 'nt');
    await fsp.mkdir(stubDir, { recursive: true });
    await fsp.writeFile(path.join(stubDir, 'python.exe'), '', 'utf8');
    const realExe = path.join(runtime, 'python.exe');
    await fsp.writeFile(realExe, '', 'utf8');

    assert.equal(isVenvTemplatePython(path.join(stubDir, 'python.exe')), true);
    assert.equal(isVenvTemplatePython(realExe), false);
    assert.equal(await findStandalonePythonExe(runtime), realExe);
  });

  it('writeSearxngSettings includes json format, secret, loopback, and port', async () => {
    await writeSearxngSettings(FIXED_PORT);
    const yaml = await fsp.readFile(getServerSettingsPath('searxng'), 'utf8');

    assert.match(yaml, /bind_address: "127\.0\.0\.1"/);
    assert.match(yaml, new RegExp(`port: ${FIXED_PORT}`));
    assert.match(yaml, /secret_key: "[0-9a-f]{64}"/);
    assert.match(yaml, /formats:\s*\n\s*- html\s*\n\s*- json/);
    assert.match(yaml, /limiter: false/);
  });

  it('getSpawnSpec returns venv python, searx module, settings env, and cwd', async () => {
    await ensureTestVenv();
    const python = venvPythonPath();

    const spec = await getSpawnSpec(FIXED_PORT);
    assert.equal(spec.command, python);
    assert.deepEqual(spec.args, ['-m', 'searx.webapp']);
    assert.equal(spec.env.SEARXNG_SETTINGS_PATH, getServerSettingsPath('searxng'));
    assert.equal(spec.env.FLASK_ENV, 'production');
    assert.ok(spec.cwd.endsWith(`${path.sep}searxng`));

    const settingsYaml = await fsp.readFile(spec.env.SEARXNG_SETTINGS_PATH, 'utf8');
    assert.match(settingsYaml, new RegExp(`port: ${FIXED_PORT}`));
  });

  it('getInstallStatus reads meta after fake install layout', async () => {
    await ensureTestVenv();
    const searxInit = path.join(getServerDir('searxng'), 'src', 'searx', '__init__.py');
    await fsp.mkdir(path.dirname(searxInit), { recursive: true });
    await fsp.writeFile(searxInit, '', 'utf8');

    const meta = {
      kind: 'python-venv',
      version: 'e964708c0',
      pythonVersion: '3.12.9',
      sizeBytes: 42,
      installedAt: '2020-01-01T00:00:00.000Z',
    };
    await fsp.mkdir(path.dirname(getServerMetaPath('searxng')), { recursive: true });
    await fsp.writeFile(getServerMetaPath('searxng'), `${JSON.stringify(meta)}\n`, 'utf8');

    const status = await getInstallStatus();
    assert.equal(status.installed, true);
    assert.equal(status.version, 'e964708c0');
    assert.equal(status.pythonVersion, '3.12.9');
    assert.equal(status.sizeBytes, 42);
  });

  it('getInstallStatus reports not installed when venv python is missing', async () => {
    await fsp.rm(getServerVenvDir('searxng'), { recursive: true, force: true });
    const status = await getInstallStatus();
    assert.equal(status.installed, false);
    assert.equal(status.version, null);
    assert.equal(status.sizeBytes, 0);
  });

  it('getInstallStatus reports not installed when pyvenv.cfg is missing', async () => {
    const python = venvPythonPath();
    await fsp.mkdir(path.dirname(python), { recursive: true });
    await fsp.writeFile(python, '', 'utf8');
    const searxInit = path.join(getServerDir('searxng'), 'src', 'searx', '__init__.py');
    await fsp.mkdir(path.dirname(searxInit), { recursive: true });
    await fsp.writeFile(searxInit, '', 'utf8');

    const status = await getInstallStatus();
    assert.equal(status.installed, false);
  });

  it('getSpawnSpec rejects corrupted venv without pyvenv.cfg', async () => {
    const python = venvPythonPath();
    await fsp.rm(getServerVenvDir('searxng'), { recursive: true, force: true });
    await fsp.mkdir(path.dirname(python), { recursive: true });
    await fsp.writeFile(python, '', 'utf8');

    await assert.rejects(
      () => getSpawnSpec(FIXED_PORT),
      /corrupted|pyvenv\.cfg/i,
    );
  });

  it('patchValkeydbForWindows replaces import pwd on win32 only', async () => {
    const valkeydbPath = path.join(tempHome, 'valkeydb-sample.py');
    const original = `import os
import pwd
import logging

    except valkey.exceptions.ValkeyError:
        _CLIENT = None
        _pw = pwd.getpwuid(os.getuid())
        logger.exception("[%s (%s)] can't connect valkey DB ...", _pw.pw_name, _pw.pw_uid)
`;
    await fsp.writeFile(valkeydbPath, original, 'utf8');

    if (process.platform === 'win32') {
      assert.equal(await patchValkeydbForWindows(valkeydbPath), true);
      const patched = await fsp.readFile(valkeydbPath, 'utf8');
      assert.match(patched, /import getpass/);
      assert.doesNotMatch(patched, /^import pwd$/m);
      assert.match(patched, /Minnow Windows compatibility patch/);
      assert.equal(await patchValkeydbForWindows(valkeydbPath), true);
    } else {
      assert.equal(await patchValkeydbForWindows(valkeydbPath), false);
      const unchanged = await fsp.readFile(valkeydbPath, 'utf8');
      assert.equal(unchanged, original);
    }
  });
});
