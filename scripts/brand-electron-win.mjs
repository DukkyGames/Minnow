#!/usr/bin/env node
/**
 * Embed Minnow branding into node_modules/electron/dist/electron.exe on Windows.
 * Dev runs use that binary, so the taskbar / Task Manager icon comes from here — not BrowserWindow.icon.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as PELibrary from 'pe-library';
import * as ResEdit from 'resedit';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** Resolve the platform Electron executable (same path spawn-electron.mjs launches). */
function resolveElectronExe() {
  try {
    const electronPath = require('electron');
    return electronPath && fs.existsSync(electronPath) ? electronPath : null;
  } catch {
    return null;
  }
}

/** Parse a semver string into Windows file-version tuple parts. */
function parseVersionTuple(version) {
  const [major = 0, minor = 0, patch = 0, build = 0] = version
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch, build];
}

/**
 * Replace the primary icon group and version metadata on a Windows executable.
 * Uses resedit (pure JS) instead of the deprecated rcedit package.
 */
function brandWindowsExecutable(exePath, iconPath, metadata) {
  const data = fs.readFileSync(exePath);
  const exe = PELibrary.NtExecutable.from(data, { ignoreCert: true });
  const resources = PELibrary.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const iconGroupId = iconGroups[0]?.id ?? 1;

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    iconGroupId,
    1033,
    iconFile.icons.map((item) => item.data),
  );

  const versionInfos = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  const versionInfo = versionInfos[0];
  if (versionInfo) {
    const [major, minor, patch, build] = parseVersionTuple(metadata.version);
    versionInfo.setFileVersion(major, minor, patch, build, 1033);
    versionInfo.setProductVersion(major, minor, patch, build, 1033);
    versionInfo.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        CompanyName: metadata.company,
        FileDescription: metadata.productName,
        ProductName: metadata.productName,
        LegalCopyright: metadata.copyright,
      },
    );
    versionInfo.outputToResourceEntries(resources.entries);
  }

  resources.outputResource(exe);
  return Buffer.from(exe.generate());
}

async function main() {
  if (process.platform !== 'win32') {
    return;
  }

  const exe = resolveElectronExe();
  if (!exe) {
    console.warn('[brand-electron-win] electron.exe not found; skipping taskbar branding.');
    return;
  }

  const icon = path.join(root, 'build', 'icon.ico');
  if (!fs.existsSync(icon)) {
    console.warn('[brand-electron-win] build/icon.ico missing; run npm run app-icon:sync first.');
    return;
  }

  const productName = pkg.build?.productName ?? 'Minnow';
  const company = typeof pkg.author === 'string' ? pkg.author : 'Grim Media';
  const version = typeof pkg.version === 'string' ? pkg.version : '1.0.0';

  const branded = brandWindowsExecutable(exe, icon, {
    productName,
    company,
    version,
    copyright: `Copyright (c) ${company}`,
  });

  const tempPath = path.join(os.tmpdir(), `minnow-electron-brand-${process.pid}.exe`);
  try {
    fs.writeFileSync(tempPath, branded);
    fs.copyFileSync(tempPath, exe);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  console.log(`[brand-electron-win] Taskbar icon set on ${exe}`);
}

main().catch((err) => {
  console.error('[brand-electron-win]', err.message || err);
  process.exit(1);
});
