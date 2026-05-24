/**
 * ask-question-enforcement prompt fragment and composer integration.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { composeSystemPrompt } from '../../src/chat/prompts/prompt-composer.ts';
import {
  loadPromptById,
  registerPromptFilesFromRaw,
  resetPromptRegistry,
} from '../../src/chat/prompts/prompt-loader.ts';
import { loadBuiltinModePromptMap } from '../modes/test-helpers.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

async function loadPromptMapWithEnforcement() {
  const toolDir = path.join(REPO_ROOT, 'src/chat/prompts/tool-usage');
  const map = await loadBuiltinModePromptMap();
  map['./tool-usage/ask-question-enforcement.full.md'] = await fs.readFile(
    path.join(toolDir, 'ask-question-enforcement.md'),
    'utf8',
  );
  map['./tool-usage/ask-question-enforcement.lite.md'] = await fs.readFile(
    path.join(toolDir, 'ask-question-enforcement.lite.md'),
    'utf8',
  );
  map['./tool-usage/default.full.md'] = await fs.readFile(
    path.join(toolDir, 'default.full.md'),
    'utf8',
  );
  map['./base/default.full.md'] = await fs.readFile(
    path.join(REPO_ROOT, 'src/chat/prompts/base/default.full.md'),
    'utf8',
  );
  return map;
}

describe('ask-question-enforcement prompts', () => {
  beforeEach(() => {
    resetPromptRegistry();
  });

  test('enforcement fragment loads with mandatory ask_question language', async () => {
    registerPromptFilesFromRaw(await loadPromptMapWithEnforcement());
    const loaded = loadPromptById('tool-usage', 'ask-question-enforcement', 'full');
    assert.ok(loaded?.body);
    assert.match(loaded.body, /must.*ask_question/i);
    assert.match(loaded.body, /numbered bullets/i);
  });

  test('composeSystemPrompt appends enforcement when ask_question is enabled', async () => {
    registerPromptFilesFromRaw(await loadPromptMapWithEnforcement());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'build',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['ask_question', 'read_file'],
      enabledToolSummaries: 'ask_question: questions',
    });
    assert.match(out, /Structured user choices \(mandatory\)/);
    assert.match(out, /ask_question/);
  });

  test('composeSystemPrompt omits enforcement when ask_question is disabled', async () => {
    registerPromptFilesFromRaw(await loadPromptMapWithEnforcement());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'build',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['read_file'],
      enabledToolSummaries: '',
    });
    assert.doesNotMatch(out, /Structured user choices \(mandatory\)/);
  });
});
