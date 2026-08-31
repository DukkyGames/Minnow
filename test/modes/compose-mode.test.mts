/**
 * Composer includes mode fragments; HTML comments stripped from composed output.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  composeSystemPrompt,
  shouldSuppressModePart,
  stripPromptHtmlComments,
} from '../../src/chat/prompts/prompt-composer.ts';
import {
  registerPromptFilesFromRaw,
  resetPromptRegistry,
} from '../../src/chat/prompts/prompt-loader.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadBuiltinModePromptMap, registerShippedWorkAgents, repoPath } from './test-helpers.mts';

async function loadBaseAndModeFixtures(): Promise<Record<string, string>> {
  const map = await loadBuiltinModePromptMap();
  const baseFull = await fs.readFile(
    repoPath('src/chat/prompts/base/default.full.md'),
    'utf8',
  );
  map['./base/default.full.md'] = baseFull;
  const toolDir = repoPath('src/chat/prompts/tool-usage');
  map['./tool-usage/default.full.md'] = await fs.readFile(
    path.join(toolDir, 'default.full.md'),
    'utf8',
  );
  map['./tool-usage/sub-agent-delegation.full.md'] = await fs.readFile(
    path.join(toolDir, 'sub-agent-delegation.md'),
    'utf8',
  );
  map['./tool-usage/sub-agent-delegation.lite.md'] = await fs.readFile(
    path.join(toolDir, 'sub-agent-delegation.lite.md'),
    'utf8',
  );
  const agentsDir = repoPath('src/chat/prompts/work-agents');
  for (const agentId of ['builder', 'planner']) {
    for (const profile of ['full', 'lite'] as const) {
      const rel = `./work-agents/${agentId}/agent.${profile}.md`;
      const abs = path.join(agentsDir, agentId, `agent.${profile}.md`);
      try {
        map[rel] = await fs.readFile(abs, 'utf8');
      } catch {
        /* optional lite */
      }
    }
  }
  return map;
}

describe('composeSystemPrompt mode part', () => {
  beforeEach(async () => {
    resetPromptRegistry();
    await registerShippedWorkAgents();
  });

  test('stripPromptHtmlComments removes MINNOW_MODE_MARKER', () => {
    const raw = '<!-- MINNOW_MODE_MARKER: plan full -->\n\n# Plan mode';
    assert.equal(stripPromptHtmlComments(raw), '# Plan mode');
  });

  test('shouldSuppressModePart when default work-agent is active', () => {
    assert.equal(
      shouldSuppressModePart({ modeId: 'build', workAgentId: 'builder' } as never),
      true,
    );
    assert.equal(
      shouldSuppressModePart({ modeId: 'build', workAgentId: 'researcher' } as never),
      false,
    );
    assert.equal(
      shouldSuppressModePart({ modeId: 'build', workAgentId: null } as never),
      false,
    );
  });

  test('plan full includes plan heading; markers stripped from compose', async () => {
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
    assert.match(out, /Operating mode: Plan/);
    assert.doesNotMatch(out, /MINNOW_MODE_MARKER/);
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
    const planOut = composeSystemPrompt({
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
    assert.notEqual(buildOut, planOut);
    assert.match(buildOut, /Operating mode: Build/);
    assert.match(planOut, /Operating mode: Plan/);
  });

  test('build with default builder suppresses mode body', async () => {
    registerPromptFilesFromRaw(await loadBaseAndModeFixtures());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: 'build',
      expertId: null,
      workAgentId: 'builder',
      workAgentLabel: 'Builder',
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: [],
      infoPresetId: null,
    });
    assert.match(out, /Work agent: Builder/);
    assert.doesNotMatch(out, /Operating mode: Build/);
  });

  test('general full includes mode handoff', async () => {
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
    assert.match(out, /Operating mode: General/);
    assert.doesNotMatch(out, /MINNOW_MODE_MARKER/);
  });

  test('lite profile uses lite mode body without marker comments', async () => {
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
      infoPresetId: null,
    });
    assert.match(out, /\*\*Build mode\.\*\*/);
    assert.doesNotMatch(out, /MINNOW_MODE_MARKER/);
    assert.doesNotMatch(out, /<!-- LITE -->/);
  });

  test('build full compose with spawn_sub_agent includes delegation fragment', async () => {
    registerPromptFilesFromRaw(await loadBaseAndModeFixtures());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: 'build',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['spawn_sub_agent', 'read_file'],
      infoPresetId: null,
    });
    assert.match(out, /Sub-agent delegation/);
    assert.match(out, /researcher/);
  });

  test('orchestrate compose omits sub-agent delegation fragment', async () => {
    registerPromptFilesFromRaw(await loadBaseAndModeFixtures());
    const out = composeSystemPrompt({
      profile: 'full',
      cwd: '/test',
      modeId: 'orchestrate',
      expertId: null,
      workAgentId: null,
      skillBody: null,
      memoryBlock: null,
      enabledToolIds: ['spawn_sub_agent'],
      infoPresetId: null,
    });
    assert.doesNotMatch(out, /Sub-agent delegation/);
  });
});
