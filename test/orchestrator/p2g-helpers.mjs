/**
 * P2-G helpers — fixture plan, fake-model scenarios, and wait utilities.
 *
 * The fake host is programmed to emit real `save_file` tool calls then
 * `report_outcome`. Tools still run in-process (P2-D); this is not a stubbed
 * effector. Product source is never the write target.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  reportOutcomeChunks,
  saveFileChunks,
} from '../../scripts/fake-model-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');

export const P2G_FIXTURE_DIR = path.join(PROJECT_ROOT, 'test', 'fixtures', 'orchestrator-v2-p2g');
export const P2G_PLAN_PATH = path.join(P2G_FIXTURE_DIR, 'plan.md');
export const P2G_RELIABILITY_PATH = path.join(HERE, 'p2g-reliability.json');

export const P2G_PLAN = fs.readFileSync(P2G_PLAN_PATH, 'utf8');

/** Files the scripted builders write into the sandbox. Keys are workspace-relative. */
export const SANDBOX_FILES = {
  'src/greet.js': "export function greet(name) {\n  return 'hello ' + name;\n}\n",
  'src/add.js': 'export function add(a, b) {\n  return a + b;\n}\n',
  'src/index.js':
    "export { greet } from './greet.js';\nexport { add } from './add.js';\n",
};

const BUILDER_PASS = {
  outcome: 'pass',
  summary: 'Wrote the file.',
  evidence: [],
  blockers: [],
  needs: [],
};
const TESTER_PASS = {
  outcome: 'pass',
  summary: 'Checks green.',
  evidence: ['sandbox files'],
  testOutput: 'ok',
};

/**
 * Happy-path scenario: each builder saves its file then reports pass; testers
 * report pass. Catch-alls cover a retry whose nth walked past the specific steps.
 *
 * @returns {Array<{ match: object, emit: string[] }>}
 */
export function happyScenario() {
  return [
    {
      match: { role: 'builder', taskId: 'W1-A', nth: 0 },
      emit: saveFileChunks('src/greet.js', SANDBOX_FILES['src/greet.js'], 'call_save_w1a'),
    },
    {
      match: { role: 'builder', taskId: 'W1-A', nth: 1 },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/greet.js'] }, 'call_rep_w1a'),
    },
    {
      match: { role: 'builder', taskId: 'W1-B', nth: 0 },
      emit: saveFileChunks('src/add.js', SANDBOX_FILES['src/add.js'], 'call_save_w1b'),
    },
    {
      match: { role: 'builder', taskId: 'W1-B', nth: 1 },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/add.js'] }, 'call_rep_w1b'),
    },
    {
      match: { role: 'builder', taskId: 'W2-A', nth: 0 },
      emit: saveFileChunks('src/index.js', SANDBOX_FILES['src/index.js'], 'call_save_w2a'),
    },
    {
      match: { role: 'builder', taskId: 'W2-A', nth: 1 },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/index.js'] }, 'call_rep_w2a'),
    },
    // Unmatched builder nth (a retry after a vanish) still reports rather than
    // falling through to V1 `board_report`, which V2's report tool would reject.
    {
      match: { role: 'builder' },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['retry'] }, 'call_rep_builder_fallback'),
    },
    {
      match: { role: 'tester' },
      emit: reportOutcomeChunks(TESTER_PASS, 'call_rep_tester'),
    },
  ];
}

/** One-task plan for induced-failure tests. parsePlan accepts this shape. */
export const MINI_PLAN = `---
name: p2g-mini
overview: Single-task board for policy routing.
todos:
  - id: W1-A
    content: "Wave 1: Mini"
    status: pending
isProject: true
---

# Mini

## Wave Breakdown

### Wave 1 — One

#### Task W1-A: Mini
- **Build:** Create \`src/mini.js\` exporting \`ok()\`.
- **Test:** The module exports \`ok\`.
- **Accept:** \`ok()\` returns true.
- **Touches:** src/mini.js
`;

const MINI_FILE = "export function ok() {\n  return true;\n}\n";

/**
 * Builder fails once, then writes the file and passes. Tester passes.
 * Seed on the retry must be `failure-aware`.
 */
export function failingBuildScenario() {
  return [
    {
      match: { role: 'builder', nth: 0 },
      emit: reportOutcomeChunks(
        {
          outcome: 'fail',
          summary: 'Did not write the file.',
          evidence: [],
          blockers: ['src/mini.js is missing'],
          needs: [],
        },
        'call_fail_build',
      ),
    },
    {
      match: { role: 'builder', nth: 1 },
      emit: saveFileChunks('src/mini.js', MINI_FILE, 'call_save_retry'),
    },
    {
      match: { role: 'builder', nth: 2 },
      emit: reportOutcomeChunks(
        { ...BUILDER_PASS, evidence: ['src/mini.js'] },
        'call_pass_build',
      ),
    },
    {
      match: { role: 'builder' },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/mini.js'] }, 'call_builder_fb'),
    },
    { match: { role: 'tester' }, emit: reportOutcomeChunks(TESTER_PASS, 'call_tester') },
  ];
}

/**
 * Builder passes (and writes). Tester fails once. Next builder uses `fix` seed.
 */
export function failingTestScenario() {
  return [
    {
      match: { role: 'builder', nth: 0 },
      emit: saveFileChunks('src/mini.js', MINI_FILE, 'call_save_mini'),
    },
    {
      match: { role: 'builder', nth: 1 },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/mini.js'] }, 'call_pass_b1'),
    },
    {
      match: { role: 'tester', nth: 0 },
      emit: reportOutcomeChunks(
        {
          outcome: 'fail',
          summary: 'ok() was undefined.',
          evidence: ['src/mini.js'],
          testOutput: 'TypeError: ok is not a function',
        },
        'call_fail_test',
      ),
    },
    {
      match: { role: 'builder' },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/mini.js'] }, 'call_fix_pass'),
    },
    { match: { role: 'tester' }, emit: reportOutcomeChunks(TESTER_PASS, 'call_tester_ok') },
  ];
}

/** Builder reports `blocked` once, then repairs and passes. */
export function blockedScenario() {
  return [
    {
      match: { role: 'builder', nth: 0 },
      emit: reportOutcomeChunks(
        {
          outcome: 'blocked',
          summary: 'No compiler in PATH.',
          evidence: [],
          blockers: [],
          needs: ['node must be on PATH'],
        },
        'call_blocked',
      ),
    },
    {
      match: { role: 'builder', nth: 1 },
      emit: saveFileChunks('src/mini.js', MINI_FILE, 'call_save_repair'),
    },
    {
      match: { role: 'builder', nth: 2 },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/mini.js'] }, 'call_repaired'),
    },
    {
      match: { role: 'builder' },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/mini.js'] }, 'call_builder_fb'),
    },
    { match: { role: 'tester' }, emit: reportOutcomeChunks(TESTER_PASS, 'call_tester') },
  ];
}

/** After a crash retry, write the file and pass. Used once the hang host is gone. */
export function afterCrashScenario() {
  return [
    {
      match: { role: 'builder', nth: 0 },
      emit: saveFileChunks('src/mini.js', MINI_FILE, 'call_save_continue'),
    },
    {
      match: { role: 'builder', nth: 1 },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/mini.js'] }, 'call_cont_pass'),
    },
    {
      match: { role: 'builder' },
      emit: reportOutcomeChunks({ ...BUILDER_PASS, evidence: ['src/mini.js'] }, 'call_builder_fb'),
    },
    { match: { role: 'tester' }, emit: reportOutcomeChunks(TESTER_PASS, 'call_tester') },
  ];
}

/**
 * @param {() => unknown | Promise<unknown>} predicate
 * @param {number} [timeoutMs]
 * @param {string} [label]
 */
export async function waitFor(predicate, timeoutMs = 30_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * @param {string} sandbox
 * @returns {Promise<void>}
 */
export async function assertSandboxFiles(sandbox) {
  for (const [rel, expected] of Object.entries(SANDBOX_FILES)) {
    const full = path.join(sandbox, rel);
    const body = await fs.promises.readFile(full, 'utf8');
    if (body !== expected) {
      throw new Error(`sandbox ${rel} did not match:\n${body}`);
    }
  }
}

/**
 * Count retries (non-initial seeds) and abandonments from a journal.
 *
 * @param {Array<Record<string, unknown>>} events
 */
export function reliabilityFromEvents(events) {
  const retries = events.filter(
    (event) =>
      event.type === 'task.attempt.started' &&
      typeof event.seedKind === 'string' &&
      event.seedKind !== 'initial',
  ).length;
  const abandonments = events.filter((event) => event.type === 'task.abandoned').length;
  const merged = events.filter((event) => event.type === 'merge.succeeded').length;
  const finished = events.some((event) => event.type === 'run.finished');
  return { retries, abandonments, merged, finished };
}
