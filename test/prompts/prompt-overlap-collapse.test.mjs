/**
 * Phase 5 / MIN-379: collapsed cross-section prompt overlap — single authoritative copies.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { composeSystemPrompt } from '../../src/chat/prompts/prompt-composer.ts';
import { estimateTokensFromText } from '../../src/chat/prompts/token-estimate-core.ts';
import {
  registerPromptFilesFromRaw,
  resetPromptRegistry,
} from '../../src/chat/prompts/prompt-loader.ts';
import { loadBuiltinModePromptMap, registerShippedWorkAgents } from '../modes/test-helpers.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

async function loadShippedOverlapPromptMap() {
  const toolDir = path.join(REPO_ROOT, 'src/chat/prompts/tool-usage');
  const baseDir = path.join(REPO_ROOT, 'src/chat/prompts/base');
  const infoDir = path.join(REPO_ROOT, 'src/chat/prompts/info');
  const workAgentDir = path.join(REPO_ROOT, 'src/chat/prompts/work-agents');
  const map = await loadBuiltinModePromptMap();
  const files = [
    ['base/default.full.md', path.join(baseDir, 'default.full.md')],
    ['base/default.lite.md', path.join(baseDir, 'default.lite.md')],
    ['tool-usage/default.full.md', path.join(toolDir, 'default.full.md')],
    ['tool-usage/default.lite.md', path.join(toolDir, 'default.lite.md')],
    ['tool-usage/ask-question-enforcement.full.md', path.join(toolDir, 'ask-question-enforcement.md')],
    ['tool-usage/ask-question-enforcement.lite.md', path.join(toolDir, 'ask-question-enforcement.lite.md')],
    ['tool-usage/mode-handoff.full.md', path.join(toolDir, 'mode-handoff.md')],
    ['tool-usage/mode-handoff.lite.md', path.join(toolDir, 'mode-handoff.lite.md')],
    ['tool-usage/fact-verification.full.md', path.join(toolDir, 'fact-verification.md')],
    ['tool-usage/fact-verification.lite.md', path.join(toolDir, 'fact-verification.lite.md')],
    ['work-agents/builder/agent.full.md', path.join(workAgentDir, 'builder/agent.full.md')],
    ['work-agents/builder/agent.lite.md', path.join(workAgentDir, 'builder/agent.lite.md')],
    ['work-agents/planner/agent.full.md', path.join(workAgentDir, 'planner/agent.full.md')],
    ['work-agents/planner/agent.lite.md', path.join(workAgentDir, 'planner/agent.lite.md')],
    ['info/general-assistant.full.md', path.join(infoDir, 'general-assistant.full.md')],
  ];
  for (const [key, abs] of files) {
    map[`./${key}`] = await fs.readFile(abs, 'utf8');
  }
  return map;
}

function countOccurrences(haystack, needle) {
  const re = new RegExp(needle, 'gi');
  return (haystack.match(re) ?? []).length;
}

describe('prompt overlap collapse (MIN-335 / MIN-379)', () => {
  beforeEach(async () => {
    resetPromptRegistry();
    await registerShippedWorkAgents();
  });

  test('Build prompt with default builder: duplicated rules appear once', async () => {
    registerPromptFilesFromRaw(await loadShippedOverlapPromptMap());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'build',
      expertId: null,
      workAgentId: 'builder',
      workAgentLabel: 'Builder',
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['ask_question', 'read_file', 'propose_mode_switch'],
      infoPresetId: 'general-assistant',
    });

    assert.equal(countOccurrences(out, 'Read before'), 1, 'read-before-write once');
    assert.equal(countOccurrences(out, 'Never invent tool'), 1, 'never-invent-output once');
    assert.equal(countOccurrences(out, 'Operating mode: Build'), 0, 'mode suppressed when builder default');
    assert.match(out, /Work agent: Builder/);
    assert.match(out, /Structured user choices \(mandatory\)/);
    assert.match(out, /Mode handoff \(structured switches\)/);
    assert.doesNotMatch(out, /General-assistant context/);
    assert.doesNotMatch(out, /## Session context[\s\S]*?## Session context/);
  });

  test('General prompt: info block renders; session context only in base', async () => {
    registerPromptFilesFromRaw(await loadShippedOverlapPromptMap());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'general',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['ask_question', 'read_file'],
      infoPresetId: 'general-assistant',
    });

    assert.match(out, /General-assistant context/);
    assert.equal(countOccurrences(out, '## Session context'), 1, 'session context only in base');
    assert.equal(countOccurrences(out, 'Date:'), 1, 'date only in base session context');
  });

  test('Build + builder composed prompt saves tokens vs pre-MIN-379 overlap stack', async () => {
    registerPromptFilesFromRaw(await loadShippedOverlapPromptMap());
    const current = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'build',
      expertId: null,
      workAgentId: 'builder',
      workAgentLabel: 'Builder',
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: [
        'ask_question',
        'read_file',
        'propose_mode_switch',
        'set_chat_mode',
        'grep',
        'save_file',
      ],
      infoPresetId: 'general-assistant',
    });

    const currentTokens = estimateTokensFromText(current);
    // Pre-MIN-379: base + build mode + builder + tool-usage stack (~5900 tok).
    const preMin379BuildTokens = 5900;
    const saved = preMin379BuildTokens - currentTokens;
    const pctSaved = (saved / preMin379BuildTokens) * 100;

    assert.ok(
      pctSaved >= 19,
      `expected meaningful tok reduction, got ${pctSaved.toFixed(1)}% (${preMin379BuildTokens} → ${currentTokens})`,
    );
  });
});
