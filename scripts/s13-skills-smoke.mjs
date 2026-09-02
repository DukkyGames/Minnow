import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../server/config/home.js';
import { listMergedSkills, getSkillById } from '../server/skills/scan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const baseUrl = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');

const USER_OVERRIDE_BODY = 'USER_OVERRIDE_FIXTURE_git-commit';

async function setupUserOverride() {
  const existing = process.env.MINNOW_HOME?.trim();
  const serverCoordinated = Boolean(existing);
  const home = serverCoordinated
    ? path.resolve(existing)
    : path.join(os.tmpdir(), `minnow-s13-${process.pid}`);

  if (!serverCoordinated) {
    process.env.MINNOW_HOME = home;
    resetMinnowHomeCache();
  }

  const skillDir = path.join(home, 'skills', 'git-commit');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---
name: git-commit
description: User override for smoke test
---
${USER_OVERRIDE_BODY}
`,
    'utf8',
  );
  return { home, serverCoordinated };
}

async function cleanupHome({ home, serverCoordinated }) {
  const skillMd = path.join(home, 'skills', 'git-commit', 'SKILL.md');
  try {
    await fs.rm(skillMd, { force: true });
  } catch {
  }

  if (serverCoordinated) {
    return;
  }

  resetMinnowHomeCache();
  delete process.env.MINNOW_HOME;
  try {
    await fs.rm(home, { recursive: true, force: true });
  } catch {
  }
}

const checks = [];

function record(id, pass, detail = '') {
  checks.push({ id, pass, detail });
}

try {
  const homeCtx = await setupUserOverride();
  const { home, serverCoordinated } = homeCtx;

  if (!serverCoordinated) {
    console.log(
      `Note: for S6, start server with MINNOW_HOME=${home} (same shell/env), then re-run this script.`,
    );
  }

  const merged = await listMergedSkills(PROJECT_ROOT);
  record('S1', merged.length >= 9, `merged count ${merged.length}`);
  const gitEntry = merged.find((s) => s.id === 'git-commit');
  record('S2', gitEntry?.source === 'user', 'user wins on git-commit');

  const detail = await getSkillById(PROJECT_ROOT, 'git-commit');
  record('S3', detail?.body?.includes(USER_OVERRIDE_BODY), 'scan getSkillById override');

  try {
    const ping = await fetch(`${baseUrl}/api/skills/ping`);
    record('S4', ping.ok, `ping HTTP ${ping.status}`);

    const listRes = await fetch(`${baseUrl}/api/skills`);
    const listText = await listRes.text();
    let listJson;
    try {
      listJson = JSON.parse(listText);
    } catch {
      listJson = null;
    }
    record(
      'S5',
      listRes.ok &&
        listJson &&
        Array.isArray(listJson.skills) &&
        listJson.skills.length >= 9,
      'GET /api/skills',
    );

    const oneRes = await fetch(`${baseUrl}/api/skills/git-commit`);
    const oneText = await oneRes.text();
    let oneJson;
    try {
      oneJson = JSON.parse(oneText);
    } catch {
      oneJson = null;
    }
    const s6BodyOk = oneJson?.skill?.body?.includes(USER_OVERRIDE_BODY);
    if (!serverCoordinated && !s6BodyOk) {
      record(
        'S6',
        false,
        `skipped: server must use MINNOW_HOME=${home} (see script header)`,
      );
    } else {
      record(
        'S6',
        oneRes.ok && s6BodyOk,
        serverCoordinated
          ? 'GET /api/skills/git-commit user body (coordinated home)'
          : 'GET /api/skills/git-commit user body',
      );
    }
  } catch (err) {
    record('S4h', false, `HTTP error: ${err.message}`);
    record('S5', false, 'skipped');
    record('S6', false, 'skipped');
  }

  await cleanupHome(homeCtx);

  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.id}${c.detail ? `: ${c.detail}` : ''}`);
  }

  const scanChecks = checks.filter((c) => ['S1', 'S2', 'S3'].includes(c.id));
  if (!scanChecks.every((c) => c.pass)) {
    process.exit(1);
  }
  const httpChecks = checks.filter((c) => ['S4', 'S5', 'S6'].includes(c.id));
  const httpFailed = httpChecks.some((c) => !c.pass);
  if (httpFailed) {
    console.log(
      'Note: S4–S6 need npm start. S6 needs MINNOW_HOME set before npm start (see script header).',
    );
    process.exit(serverCoordinated ? 1 : 0);
  }
  console.log('s13-skills-smoke: all checks passed');
} catch (err) {
  console.error('s13-skills-smoke failed:', err);
  process.exit(1);
}
