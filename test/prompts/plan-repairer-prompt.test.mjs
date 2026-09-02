/**
 * Static checks for plan-repairer sub-agent prompts (board plan repair).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SHIPPED_SUB_AGENT_PROMPTS } from '../../src/agents/shipped-sub-agent-prompts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PROMPT_DIR = path.join(REPO_ROOT, 'src/agents/prompts/sub-agents');

async function readPrompt(name) {
  return (await fs.readFile(path.join(PROMPT_DIR, name), 'utf8')).trim();
}

describe('plan-repairer sub-agent prompts', () => {
  test('plan-repairer.full is schema-only, in-place save_file, unattended', async () => {
    const body = await readPrompt('plan-repairer.full.md');
    assert.ok(body.length > 0, 'plan-repairer.full shipped prompt must be non-empty');
    assert.ok(body.includes('Required plan schema'), 'must embed the planner schema');
    assert.ok(body.includes('## Wave Breakdown'), 'must require Wave Breakdown');
    assert.ok(body.includes('#### Task'), 'must require Task headings');
    assert.ok(body.includes('save_file'), 'must overwrite in place with save_file');
    assert.ok(body.includes('sidecar') === false || body.includes('No sidecar'), 'must forbid sidecar copies');
    assert.ok(body.includes('ask_question'), 'must mention ask_question so it can forbid it');
    assert.ok(body.includes('not') && body.includes('in this chat'), 'must be unattended');
    assert.ok(body.includes('Do not split, merge'));
  });

  test('plan-repairer.lite summarizes contract', async () => {
    const body = await readPrompt('plan-repairer.lite.md');
    assert.ok(body.includes('save_file'));
    assert.ok(body.includes('schema-only') || body.includes('schema only'));
    assert.ok(body.includes('ask_question'));
  });

  test('shipped map matches the in-place unattended contract', () => {
    const body = SHIPPED_SUB_AGENT_PROMPTS['plan-repairer.full'] ?? '';
    assert.ok(body.includes('plan repairer'));
    assert.ok(body.includes('save_file'));
    assert.ok(body.includes('Wave Breakdown'));
    assert.ok(SHIPPED_SUB_AGENT_PROMPTS['plan-repairer.lite']?.includes('save_file'));
  });
});
