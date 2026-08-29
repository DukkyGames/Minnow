/**
 * Orchestrate mode prompts must document board_* tools (not progress.md).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODES_DIR = path.join(__dirname, '../../src/chat/prompts/modes');
const ORCHESTRATOR_DIR = path.join(
  __dirname,
  '../../src/chat/prompts/work-agents/orchestrator',
);

const BOARD_TOOLS = ['board_init', 'board_update_task', 'board_get_state'];
const PROMPT_FILES = ['orchestrate.full.md', 'orchestrate.lite.md'];

/** Prompt must teach distinct field names and common failure modes. */
const BOARD_API_CONTRACT = [
  { pattern: /"task_id"/, label: 'board_update_task JSON must show task_id' },
  { pattern: /tasks\[\]\.id|"id":\s*"W1-A"/, label: 'board_init tasks must use id' },
  {
    pattern: /board_task_id|requires non-empty "tasks"|plan_path alone/i,
    label: 'board_init / spawn linkage or empty-tasks guard',
  },
  {
    pattern: /not\s*`id`|not\s+`id`|Do not use the field name id/i,
    label: 'must warn against using id on board_update_task',
  },
];

/** Patterns that indicate the legacy markdown progress-file workflow. */
const FORBIDDEN_PROGRESS_PATTERNS = [
  /documentation\/progress\//i,
  /-progress\.md/i,
  /progress file format/i,
  /most state lives in the progress file/i,
];

function readPrompt(name) {
  return fs.readFileSync(path.join(MODES_DIR, name), 'utf8');
}

function assertBoardPromptContract(name, content) {
  for (const tool of BOARD_TOOLS) {
    assert.ok(
      content.includes(tool),
      `${name} must mention ${tool}`,
    );
  }

  for (const pattern of FORBIDDEN_PROGRESS_PATTERNS) {
    assert.ok(
      !pattern.test(content),
      `${name} must not match forbidden progress pattern: ${pattern}`,
    );
  }

  assert.ok(
    /spawn_sub_agent/i.test(content) && /category/i.test(content),
    `${name} must mention spawn_sub_agent category`,
  );
  assert.ok(
    content.includes('board_task_id'),
    `${name} must mention board_task_id on spawn_sub_agent`,
  );

  for (const { pattern, label } of BOARD_API_CONTRACT) {
    assert.ok(pattern.test(content), `${name}: ${label}`);
  }
}

describe('orchestrate board prompts', () => {
  test('orchestrate board_init example has no self-dependency in dependsOn', () => {
    const content = readPrompt('orchestrate.full.md');
    const exampleBlock = content.match(/```json[\s\S]*?```/)?.[0] ?? '';
    assert.ok(exampleBlock.length > 0, 'board_init JSON example present');
    assert.doesNotMatch(
      exampleBlock,
      /"dependsOn":\s*\[\s*"W1-A"\s*\]/,
      'example must not show a task depending on itself',
    );
  });

  for (const file of PROMPT_FILES) {
    test(`${file} documents board tools and spawn linkage`, () => {
      const content = readPrompt(file);
      assertBoardPromptContract(file, content);
    });
  }
});

describe('orchestrator work-agent bound-plan contract', () => {
  function readAgent(name) {
    return fs.readFileSync(path.join(ORCHESTRATOR_DIR, name), 'utf8');
  }

  test('agent.full.md never-asks when {{orchestrate_plan}} is set', () => {
    const content = readAgent('agent.full.md');
    assert.ok(
      content.includes('{{orchestrate_plan}}'),
      'full prompt must interpolate the bound plan path',
    );
    assert.match(
      content,
      /do \*\*not\*\* ask the user to pick among plan files/i,
    );
  });

  test('agent.lite.md never-asks when {{orchestrate_plan}} is set', () => {
    const content = readAgent('agent.lite.md');
    assert.ok(
      content.includes('{{orchestrate_plan}}'),
      'lite prompt must interpolate the bound plan path',
    );
    assert.match(content, /do \*\*not\*\* ask which plan to use/i);
  });
});
