/**
 * P2-E — V2 Builder and Tester prompts (MIN-702).
 *
 * V1's work-agent prompts stay put (`board_report` / `env_blocked`). These
 * files are the V2 lineage: `blocked` is defined, and boards / waves /
 * delegation / lifecycle reporting are gone.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROMPTS_DIR = path.join(PROJECT_ROOT, 'server', 'orchestrator', 'prompts');
const V1_BUILDER = path.join(PROJECT_ROOT, 'src', 'chat', 'prompts', 'work-agents', 'builder', 'agent.full.md');
const V1_TESTER = path.join(PROJECT_ROOT, 'src', 'chat', 'prompts', 'work-agents', 'tester', 'agent.full.md');

const FILES = [
  ['builder', 'full', path.join(PROMPTS_DIR, 'builder', 'agent.full.md')],
  ['builder', 'lite', path.join(PROMPTS_DIR, 'builder', 'agent.lite.md')],
  ['tester', 'full', path.join(PROMPTS_DIR, 'tester', 'agent.full.md')],
  ['tester', 'lite', path.join(PROMPTS_DIR, 'tester', 'agent.lite.md')],
];

function read(abs) {
  return fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
}

describe('V1 prompts are untouched', () => {
  it('still documents board_report / env_blocked', () => {
    const builder = read(V1_BUILDER);
    const tester = read(V1_TESTER);
    assert.match(builder, /board_report/);
    assert.match(builder, /env_blocked/);
    assert.match(tester, /board_report/);
  });
});

describe('V2 prompts exist with front-matter', () => {
  for (const [role, profile, abs] of FILES) {
    it(`${role} ${profile} has front-matter and report_outcome`, () => {
      const body = read(abs);
      assert.match(body, /^---\n/);
      assert.match(body, /\nid: /);
      assert.match(body, /report_outcome/);
    });
  }
});

describe('Builder prompt states the blocked criterion', () => {
  for (const profile of ['full', 'lite']) {
    it(`${profile} defines blocked as an environment problem, not a hard build`, () => {
      const body = read(path.join(PROMPTS_DIR, 'builder', `agent.${profile}.md`));
      assert.match(body, /`blocked` means the environment cannot support the work/i);
      assert.match(body, /missing dependency/i);
      assert.match(body, /unstartable service/i);
      assert.match(body, /absent credential/i);
      assert.match(body, /does \*\*not\*\* mean the code is hard/i);
      assert.match(body, /not an escape hatch from a failing build/i);
    });
  }
});

describe('Tester prompt has no blocked outcome', () => {
  for (const profile of ['full', 'lite']) {
    it(`${profile} allows pass or fail only`, () => {
      const body = read(path.join(PROMPTS_DIR, 'tester', `agent.${profile}.md`));
      assert.match(body, /pass.*fail/);
      assert.match(body, /do \*\*not\*\* report `blocked`|You do not report `blocked`/i);
      assert.equal(body.includes("outcome: \"pass\" | \"fail\" | \"blocked\""), false);
    });
  }
});

describe('neither V2 prompt mentions boards, waves, delegation, or lifecycle reporting', () => {
  const banned = [
    [/\bboards?\b/i, 'board'],
    [/\bwaves?\b/i, 'wave'],
    [/\bdelegat/i, 'delegat'],
    [/lifecycle/i, 'lifecycle'],
    [/board_report/, 'board_report'],
    [/board_init/, 'board_init'],
    [/delegate_tasks/, 'delegate_tasks'],
    [/env_blocked/, 'env_blocked'],
    [/env-fixer/, 'env-fixer'],
    [/merge-fixer/, 'merge-fixer'],
    [/VERDICT:/, 'VERDICT recovery marker'],
  ];

  for (const [role, profile, abs] of FILES) {
    it(`${role} ${profile} is clean`, () => {
      const body = read(abs);
      // Strip YAML front-matter so `id:` lines cannot false-positive.
      const start = body.indexOf('\n---\n');
      const content = start >= 0 ? body.slice(start + 5) : body;
      for (const [re, label] of banned) {
        assert.equal(re.test(content), false, `${role}/${profile} mentions ${label}`);
      }
    });
  }
});

describe('V2 builder has no "do not call delegate_tasks" leftover', () => {
  it('does not mention the deleted tool even as a prohibition', () => {
    const full = read(path.join(PROMPTS_DIR, 'builder', 'agent.full.md'));
    const lite = read(path.join(PROMPTS_DIR, 'builder', 'agent.lite.md'));
    assert.equal(full.includes('delegate_tasks'), false);
    assert.equal(lite.includes('delegate_tasks'), false);
  });
});
