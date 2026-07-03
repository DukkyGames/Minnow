/**
 * Phase 5: collapsed cross-section prompt overlap — single authoritative copies.
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
import { loadBuiltinModePromptMap } from '../modes/test-helpers.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

async function loadShippedOverlapPromptMap() {
  const toolDir = path.join(REPO_ROOT, 'src/chat/prompts/tool-usage');
  const baseDir = path.join(REPO_ROOT, 'src/chat/prompts/base');
  const infoDir = path.join(REPO_ROOT, 'src/chat/prompts/info');
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

describe('prompt overlap collapse (MIN-335)', () => {
  beforeEach(() => {
    resetPromptRegistry();
  });

  test('Build prompt: duplicated rules appear once; key guidance retained', async () => {
    registerPromptFilesFromRaw(await loadShippedOverlapPromptMap());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'build',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['ask_question', 'read_file', 'propose_mode_switch'],
      infoPresetId: 'general-assistant',
    });

    assert.equal(countOccurrences(out, 'Read before'), 1, 'read-before-write once');
    assert.equal(countOccurrences(out, 'Never invent tool'), 1, 'never-invent-output once');
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

  test('Build composed prompt saves ~400 tokens vs pre-Phase-5 overlap', async () => {
    registerPromptFilesFromRaw(await loadShippedOverlapPromptMap());
    const current = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'build',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['ask_question', 'read_file', 'propose_mode_switch', 'set_chat_mode'],
      infoPresetId: 'general-assistant',
    });

    const currentTokens = estimateTokensFromText(current);
    // Measured from shipped prompts before MIN-335 (same compose context).
    const prePhase5BuildTokens = 5652;
    const saved = prePhase5BuildTokens - currentTokens;

    assert.ok(saved >= 350, `expected ~400 tok saved, got ${saved} (${prePhase5BuildTokens} → ${currentTokens})`);
  });
});
