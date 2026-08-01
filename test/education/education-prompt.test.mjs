/**
 * Education Mode prompt fragment — presence across modes, the work-agent
 * suppression case, level interpolation, and delegation suppression.
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
import {
  loadBuiltinModePromptMap,
  registerShippedWorkAgents,
} from '../modes/test-helpers.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

async function loadEducationPromptMap() {
  const toolDir = path.join(REPO_ROOT, 'src/chat/prompts/tool-usage');
  const baseDir = path.join(REPO_ROOT, 'src/chat/prompts/base');
  const map = await loadBuiltinModePromptMap();
  map['./tool-usage/education.full.md'] = await fs.readFile(
    path.join(toolDir, 'education.md'),
    'utf8',
  );
  map['./tool-usage/education.lite.md'] = await fs.readFile(
    path.join(toolDir, 'education.lite.md'),
    'utf8',
  );
  map['./tool-usage/sub-agent-delegation.full.md'] = await fs.readFile(
    path.join(toolDir, 'sub-agent-delegation.md'),
    'utf8',
  );
  map['./tool-usage/default.full.md'] = await fs.readFile(
    path.join(toolDir, 'default.full.md'),
    'utf8',
  );
  map['./tool-usage/default.lite.md'] = await fs.readFile(
    path.join(toolDir, 'default.lite.md'),
    'utf8',
  );
  map['./base/default.full.md'] = await fs.readFile(
    path.join(baseDir, 'default.full.md'),
    'utf8',
  );
  map['./base/default.lite.md'] = await fs.readFile(
    path.join(baseDir, 'default.lite.md'),
    'utf8',
  );
  return map;
}

function ctx(overrides = {}) {
  return {
    profile: 'full',
    cwd: '/proj',
    modeId: 'build',
    expertId: null,
    workAgentId: null,
    skillBody: null,
    memoryBlock: null,
    enabledToolIds: ['read_file', 'execute_command'],
    ...overrides,
  };
}

describe('education prompt fragment', () => {
  beforeEach(async () => {
    resetPromptRegistry();
    registerPromptFilesFromRaw(await loadEducationPromptMap());
  });

  test('fragment loads with the hard rule and the hint ladder', () => {
    const loaded = loadPromptById('tool-usage', 'education', 'full');
    assert.ok(loaded?.body);
    assert.match(loaded.body, /programming tutor/);
    assert.match(loaded.body, /Never output a complete or near-complete implementation/);
    assert.match(loaded.body, /hint ladder/i);
    assert.match(loaded.body, /\{\{education_level\}\}/);
  });

  test('lite variant keeps the hard rule and the ladder', () => {
    const loaded = loadPromptById('tool-usage', 'education', 'lite');
    assert.ok(loaded?.body);
    assert.match(loaded.body, /Never output a complete or near-complete implementation/);
    assert.match(loaded.body, /Hint ladder/i);
  });

  for (const profile of ['full', 'lite']) {
    test(`${profile} variant places the tutor inside Minnow with the editor tool`, () => {
      const loaded = loadPromptById('tool-usage', 'education', profile);
      assert.ok(loaded?.body);
      // The tutor kept asking students which code editor they were using.
      assert.match(loaded.body, /Minnow is their editor/);
      assert.match(loaded.body, /Never ask what editor/i);
      assert.match(loaded.body, /open_in_editor/);
      assert.match(loaded.body, /\{\{cwd\}\}/);
    });
  }

  test('interpolates the workspace path into the tutor fragment', () => {
    const out = composeSystemPrompt(ctx({ educationEnabled: true, cwd: '/repo/shop' }));
    assert.match(out, /workspace is `\/repo\/shop`/);
    assert.doesNotMatch(out, /\{\{cwd\}\}/);
  });

  for (const modeId of ['build', 'general', 'debug', 'plan', 'orchestrate']) {
    test(`appears in ${modeId} mode when the flag is on`, () => {
      const out = composeSystemPrompt(ctx({ modeId, educationEnabled: true }));
      assert.match(out, /# Education Mode/);
      assert.match(out, /programming tutor/);
    });
  }

  test('absent when the flag is off', () => {
    const out = composeSystemPrompt(ctx({ educationEnabled: false }));
    assert.doesNotMatch(out, /# Education Mode/);
    assert.doesNotMatch(out, /programming tutor/);
  });

  test('absent when the flag is unset', () => {
    const out = composeSystemPrompt(ctx());
    assert.doesNotMatch(out, /# Education Mode/);
  });

  test('appears even when the default work-agent suppresses the mode body', async () => {
    await registerShippedWorkAgents();
    const suppressed = composeSystemPrompt(
      ctx({ modeId: 'build', workAgentId: 'builder', educationEnabled: true }),
    );
    // shouldSuppressModePart drops the mode part for the mode's default agent.
    assert.doesNotMatch(suppressed, /MINNOW_MODE_MARKER/);
    assert.match(suppressed, /# Education Mode/);
  });

  test('is the last section, so it overrides everything before it', () => {
    const out = composeSystemPrompt(
      ctx({
        educationEnabled: true,
        memoryBlock: 'note',
        memoryEnabled: true,
        codeMapBlock: 'map',
        codeMapInjectionEnabled: true,
      }),
    );
    const sections = out.split('\n\n---\n\n');
    assert.match(sections[sections.length - 1], /# Education Mode/);
  });

  test('interpolates the teaching level', () => {
    const advanced = composeSystemPrompt(
      ctx({ educationEnabled: true, educationLevel: 'advanced' }),
    );
    assert.match(advanced, /Teaching level: advanced/);
    assert.doesNotMatch(advanced, /\{\{education_level\}\}/);

    const fallback = composeSystemPrompt(ctx({ educationEnabled: true }));
    assert.match(fallback, /Teaching level: beginner/);
  });

  test('lite profile still gets the fragment', () => {
    const out = composeSystemPrompt(
      ctx({ profile: 'lite', educationEnabled: true, educationLevel: 'intermediate' }),
    );
    assert.match(out, /# Education Mode/);
    assert.match(out, /Teaching level: intermediate/);
  });

  test('suppresses the sub-agent delegation fragment body', () => {
    const withDelegation = composeSystemPrompt(
      ctx({ enabledToolIds: ['spawn_sub_agent', 'read_file'] }),
    );
    // Other fragments name the section in prose, so assert on the body, not the heading.
    assert.match(withDelegation, /summaries arrive automatically as a new turn/);

    const educational = composeSystemPrompt(
      ctx({ enabledToolIds: ['spawn_sub_agent', 'read_file'], educationEnabled: true }),
    );
    assert.doesNotMatch(educational, /summaries arrive automatically as a new turn/);
  });

  test('covers the gap left by suppressing delegation', () => {
    const out = composeSystemPrompt(
      ctx({ enabledToolIds: ['spawn_sub_agent', 'read_file'], educationEnabled: true }),
    );
    // Another fragment cross-references the suppressed section; say so explicitly
    // and keep read-only investigation available.
    assert.match(out, /sub-agent delegation section is deliberately absent/i);
    assert.match(out, /never a sub-agent to write, edit, or implement code/i);
  });
});
