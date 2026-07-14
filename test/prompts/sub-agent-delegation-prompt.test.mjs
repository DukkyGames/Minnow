/**
 * Sub-agent delegation prompt fragment and composer integration.
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

async function loadDelegationPromptMap() {
  const toolDir = path.join(REPO_ROOT, 'src/chat/prompts/tool-usage');
  const baseDir = path.join(REPO_ROOT, 'src/chat/prompts/base');
  const map = await loadBuiltinModePromptMap();
  map['./tool-usage/sub-agent-delegation.full.md'] = await fs.readFile(
    path.join(toolDir, 'sub-agent-delegation.md'),
    'utf8',
  );
  map['./tool-usage/sub-agent-delegation.lite.md'] = await fs.readFile(
    path.join(toolDir, 'sub-agent-delegation.lite.md'),
    'utf8',
  );
  map['./tool-usage/default.full.md'] = await fs.readFile(
    path.join(toolDir, 'default.full.md'),
    'utf8',
  );
  map['./base/default.full.md'] = await fs.readFile(
    path.join(baseDir, 'default.full.md'),
    'utf8',
  );
  return map;
}

describe('sub-agent-delegation prompts', () => {
  beforeEach(() => {
    resetPromptRegistry();
  });

  test('sub-agent-delegation fragment loads with key types and wait: false', async () => {
    registerPromptFilesFromRaw(await loadDelegationPromptMap());
    const loaded = loadPromptById('tool-usage', 'sub-agent-delegation', 'full');
    assert.ok(loaded?.body);
    assert.match(loaded.body, /researcher/);
    assert.match(loaded.body, /generalPurpose/);
    assert.match(loaded.body, /wait: false/);
  });

  test('composeSystemPrompt appends delegation for build when spawn_sub_agent enabled', async () => {
    registerPromptFilesFromRaw(await loadDelegationPromptMap());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'build',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['spawn_sub_agent', 'read_file'],
    });
    assert.match(out, /Sub-agent delegation/);
    assert.match(out, /generalPurpose/);
    assert.match(out, /Operating mode: Build/);
  });

  test('composeSystemPrompt omits delegation fragment when spawn_sub_agent disabled', async () => {
    registerPromptFilesFromRaw(await loadDelegationPromptMap());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'build',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['read_file'],
    });
    // Mode one-liner may reference the fragment by name; assert fragment body is absent.
    assert.doesNotMatch(out, /Self-contained implementation chunk.*generalPurpose/s);
    assert.doesNotMatch(out, /summaries arrive automatically as a new turn/);
  });

  test('composeSystemPrompt omits delegation for orchestrate mode', async () => {
    registerPromptFilesFromRaw(await loadDelegationPromptMap());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/proj',
      modeId: 'orchestrate',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['spawn_sub_agent'],
    });
    assert.doesNotMatch(out, /Sub-agent delegation/);
  });
});
