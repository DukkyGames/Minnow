/**
 * Vendors Impeccable upstream reference/ and scripts/ into src/skills/impeccable/.
 * Preserves SpeedChat-authored SKILL.md; writes SKILL.upstream.md from upstream.
 *
 * Env:
 *   IMPECCABLE_SYNC_STRICT=1  — exit non-zero on install/sync failure (CI)
 *   IMPECCABLE_SKILL_TARGET   — override built-in skill dir (default src/skills/impeccable)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const STRICT = process.env.IMPECCABLE_SYNC_STRICT === '1';
const TARGET_DIR = path.resolve(
  PROJECT_ROOT,
  process.env.IMPECCABLE_SKILL_TARGET || 'src/skills/impeccable',
);

/** Provider dirs where `npx impeccable skills install` places the skill. */
const UPSTREAM_CANDIDATES = [
  path.join(PROJECT_ROOT, '.agents', 'skills', 'impeccable'),
  path.join(PROJECT_ROOT, '.cursor', 'skills', 'impeccable'),
  path.join(PROJECT_ROOT, '.claude', 'skills', 'impeccable'),
];

const SYNC_SUBDIRS = ['reference', 'scripts'];

/**
 * @param {string} message
 */
function warn(message) {
  console.warn(`[impeccable:sync] ${message}`);
}

/**
 * @param {string} message
 */
function fail(message) {
  if (STRICT) {
    console.error(`[impeccable:sync] ${message}`);
    process.exit(1);
  }
  warn(`${message} (non-strict; set IMPECCABLE_SYNC_STRICT=1 to fail CI)`);
}

/**
 * @returns {string | null}
 */
function findUpstreamDir() {
  for (const candidate of UPSTREAM_CANDIDATES) {
    const skillMd = path.join(candidate, 'SKILL.md');
    if (fs.existsSync(skillMd)) return candidate;
  }
  return null;
}

/**
 * Run upstream installer when vendored assets are missing.
 */
function ensureUpstreamInstalled() {
  if (findUpstreamDir()) return;

  warn('Upstream skill not found; running npx impeccable skills install -y …');
  const result = spawnSync(
    'npx',
    ['impeccable', 'skills', 'install', '-y'],
    {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, CI: process.env.CI || '1' },
    },
  );

  if (result.status !== 0) {
    fail(`impeccable skills install exited with code ${result.status ?? 'unknown'}`);
  }
}

/**
 * @param {string} src
 * @param {string} dest
 */
function copyTree(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

/**
 * @param {string} upstreamDir
 */
function syncFromUpstream(upstreamDir) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  const upstreamSkill = path.join(upstreamDir, 'SKILL.md');
  const upstreamCopy = path.join(TARGET_DIR, 'SKILL.upstream.md');
  const header =
    '<!-- AUTO-SYNCED from Impeccable upstream — do not edit; run npm run impeccable:sync -->\n\n';
  fs.writeFileSync(
    upstreamCopy,
    header + fs.readFileSync(upstreamSkill, 'utf8'),
    'utf8',
  );

  for (const sub of SYNC_SUBDIRS) {
    const from = path.join(upstreamDir, sub);
    const to = path.join(TARGET_DIR, sub);
    if (!fs.existsSync(from)) {
      fail(`Missing upstream ${sub}/ in ${upstreamDir}`);
      continue;
    }
    copyTree(from, to);
  }

  const speedchatSkill = path.join(TARGET_DIR, 'SKILL.md');
  if (!fs.existsSync(speedchatSkill)) {
    fail(
      `Missing SpeedChat wrapper ${path.relative(PROJECT_ROOT, speedchatSkill)} — commit SKILL.md before sync`,
    );
  }
}

function main() {
  ensureUpstreamInstalled();
  const upstream = findUpstreamDir();
  if (!upstream) {
    fail('Could not locate upstream impeccable skill after install');
    return;
  }

  syncFromUpstream(upstream);
  console.log(
    `[impeccable:sync] Synced reference/ and scripts/ → ${path.relative(PROJECT_ROOT, TARGET_DIR)}`,
  );
}

main();
