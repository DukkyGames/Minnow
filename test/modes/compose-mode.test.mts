/**
 * Composer includes mode fragments with markers.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { composeSystemPrompt } from '../../src/chat/prompts/prompt-composer.ts';
import {
  registerPromptFilesFromRaw,
  resetPromptRegistry,
} from '../../src/chat/prompts/prompt-loader.ts';
import fs from 'node:fs/promises';
import { loadBuiltinModePromptMap, repoPath } from './test-helpers.mts';

async function loadBaseAndModeFixtures(): Promise<Record<string, string>> {
  const map = await loadBuiltinModePromptMap();
  const baseFull = await fs.readFile(
    repoPath('src/chat/prompts/base/default.full.md'),
    'utf8',
  );
  map['./base/default.full.md'] = baseFull;
  return map;
}

describe('composeSystemPrompt mode part', () => {
  beforeEach(() => {
    resetPromptRegistry();
  });

  test('plan full includes plan marker', async () => {
    registerPromptFilesFromRaw(await loadBaseAndModeFixtures());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: 'plan',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: [],
      infoPresetId: null,
    });
    assert.match(out, /MINNOW_MODE_MARKER: plan full/);
  });

  test('switching modeId changes composed output', async () => {
    registerPromptFilesFromRaw(await loadBaseAndModeFixtures());
    const buildOut = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: 'build',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: [],
      infoPresetId: null,
    });
    const researchOut = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: 'research',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: [],
      infoPresetId: null,
    });
    assert.notEqual(buildOut, researchOut);
    assert.match(buildOut, /build full/);
    assert.match(researchOut, /research full/);
  });

  test('general full includes general marker', async () => {
    registerPromptFilesFromRaw(await loadBaseAndModeFixtures());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: 'general',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: [],
      infoPresetId: null,
    });
    assert.match(out, /MINNOW_MODE_MARKER: general full/);
    assert.match(out, /Mode handoff/);
  });

  test('reef full includes reef marker', async () => {
    registerPromptFilesFromRaw(await loadBaseAndModeFixtures());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: 'reef',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: [],
      infoPresetId: null,
    });
    assert.match(out, /MINNOW_MODE_MARKER: reef full/);
    assert.match(out, /reef-widget/);
  });

  test('lite profile uses lite marker', async () => {
    registerPromptFilesFromRaw(await loadBaseAndModeFixtures());
    const out = composeSystemPrompt({
      profile: 'lite',
      cwd: '/test',
      modeId: 'build',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['get_datetime'],
      enabledToolSummaries: 'get_datetime',
      infoPresetId: null,
    });
    assert.match(out, /MINNOW_MODE_MARKER: build lite/);
    assert.match(out, /LITE/);
  });
});
