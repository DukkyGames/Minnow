/**
 * Planner work agent tool allowlist — Context7 for library verification in Plan mode.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { parseWorkAgentMetaFromMarkdown } from '../../src/agents/work-agent-meta-parse.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const plannerPath = join(
  __dirname,
  '../../src/chat/prompts/work-agents/planner/agent.full.md',
);

const CONTEXT7_TOOL_IDS = [
  'mcp__context7__resolve-library-id',
  'mcp__context7__get-library-docs',
];

const ISSUE_TOOL_IDS = [
  'issue_add',
  'issue_update',
  'issue_link',
  'issue_get_state',
  'issue_delete',
  'issue_search',
  'issue_comment',
  'issue_assign',
  'issue_unlink',
  'issue_move',
];

describe('planner work agent allowedTools', () => {
  test('includes Context7 MCP tools for library/API verification', async () => {
    const raw = await readFile(plannerPath, 'utf8');
    const meta = parseWorkAgentMetaFromMarkdown(raw, plannerPath);
    assert.ok(meta);
    assert.ok(Array.isArray(meta.allowedTools));

    for (const toolId of CONTEXT7_TOOL_IDS) {
      assert.ok(
        meta.allowedTools.includes(toolId),
        `planner allowedTools should include ${toolId}`,
      );
    }
  });

  test('includes issue_* tools so Plan mode can file and attach plans', async () => {
    const raw = await readFile(plannerPath, 'utf8');
    const meta = parseWorkAgentMetaFromMarkdown(raw, plannerPath);
    assert.ok(meta);
    assert.ok(Array.isArray(meta.allowedTools));

    for (const toolId of ISSUE_TOOL_IDS) {
      assert.ok(
        meta.allowedTools.includes(toolId),
        `planner allowedTools should include ${toolId}`,
      );
    }
  });
});
