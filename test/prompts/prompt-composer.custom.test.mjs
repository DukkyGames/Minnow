/**
 * Custom profile: contentOverride and enabled flags.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { beforeEach, describe, test } from 'node:test';
import { composeSystemPrompt } from '../../src/chat/prompts/prompt-composer.ts';
import {
  registerPromptFilesFromRaw,
  resetPromptRegistry,
} from '../../src/chat/prompts/prompt-loader.ts';
import { fixturePath } from './test-helpers.mjs';

describe('prompt-composer custom', () => {
  beforeEach(async () => {
    resetPromptRegistry();
    const base = await fs.readFile(fixturePath('base-default.full.md'), 'utf8');
    const tools = await fs.readFile(fixturePath('tool-usage-default.full.md'), 'utf8');
    registerPromptFilesFromRaw({
      './base/default.full.md': base,
      './tool-usage/default.full.md': tools,
    });
  });

  test('contentOverride on tool-usage appears verbatim', () => {
    const out = composeSystemPrompt({
      profile: 'custom',
      customConfig: {
        id: 'test',
        label: 'Test',
        profile: 'custom',
        parts: {
          base: { enabled: true, contentOverride: null },
          'tool-usage': {
            enabled: true,
            contentOverride: 'OVERRIDE_TOOLS_TEXT',
          },
        },
      },
      cwd: '/x',
      modeId: null,
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['get_datetime'],
      infoPresetId: null,
    });
    assert.ok(out.includes('OVERRIDE_TOOLS_TEXT'));
    assert.ok(!out.includes('TOOLS_FULL'));
  });

  test('expert.enabled false omits expert block', () => {
    registerPromptFilesFromRaw({
      './experts/demo.full.md': `---
id: demo
kind: expert
label: Demo
version: 1
---
EXPERT_BLOCK`,
    });
    const out = composeSystemPrompt({
      profile: 'custom',
      customConfig: {
        id: 'no-expert',
        label: 'No expert',
        profile: 'custom',
        parts: {
          base: { enabled: true, contentOverride: null },
          expert: { enabled: false, contentOverride: null },
        },
      },
      cwd: '/x',
      modeId: null,
      expertId: 'demo',
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: [],
      infoPresetId: null,
    });
    assert.ok(!out.includes('EXPERT_BLOCK'));
  });
});
