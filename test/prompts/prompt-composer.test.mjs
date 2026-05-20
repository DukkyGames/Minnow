/**
 * Prompt composer: order, separators, disabled parts.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { beforeEach, describe, test } from 'node:test';
import {
  composeSystemPrompt,
  PART_ORDER,
} from '../../src/chat/prompts/prompt-composer.ts';
import {
  registerPromptFilesFromRaw,
  resetPromptRegistry,
} from '../../src/chat/prompts/prompt-loader.ts';
import { fixturePath } from './test-helpers.mjs';

async function loadFixtureMap() {
  const names = [
    'base-default.full.md',
    'base-default.lite.md',
    'tool-usage-default.full.md',
    'tool-usage-default.lite.md',
    'info-general-assistant.full.md',
  ];
  const map = {};
  for (const name of names) {
    const folder =
      name.startsWith('base') ? 'base' : name.startsWith('tool') ? 'tool-usage' : 'info';
    const key = `./${folder}/${name}`;
    map[key] = await fs.readFile(fixturePath(name), 'utf8');
  }
  return map;
}

describe('prompt-composer', () => {
  beforeEach(() => {
    resetPromptRegistry();
  });

  test('PART_ORDER matches spec', () => {
    assert.deepEqual(PART_ORDER, [
      'base',
      'mode',
      'expert',
      'work-agent',
      'tool-usage',
      'info',
      'skill',
      'memory',
    ]);
  });

  test('composition order and separators', async () => {
    registerPromptFilesFromRaw(await loadFixtureMap());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: null,
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['get_datetime'],
      enabledToolSummaries: 'get_datetime: clock',
      infoPresetId: 'general-assistant',
    });
    const parts = out.split('\n\n---\n\n');
    assert.ok(parts[0].includes('BASE_FULL_BODY'));
    assert.ok(parts[1].includes('TOOLS_FULL'));
    assert.ok(parts[2].includes('INFO_GENERAL_BODY'));
    assert.equal(parts.length, 3);
  });

  test('disabled info in lite profile', async () => {
    registerPromptFilesFromRaw(await loadFixtureMap());
    const out = composeSystemPrompt({
      profile: 'lite',
      cwd: '/test',
      modeId: null,
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['a', 'b'],
      enabledToolSummaries: 'a, b',
      infoPresetId: 'general-assistant',
    });
    assert.ok(out.includes('BASE_LITE_BODY'));
    assert.ok(out.includes('TOOLS_LITE'));
    assert.ok(!out.includes('INFO_GENERAL_BODY'));
  });
});
