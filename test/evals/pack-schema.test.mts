/**
 * Eval pack schema validation tests.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateEvalPack } from '../../src/evals/pack-schema.ts';

const VALID_PACK = `{
  "id": "pack-11111111",
  "label": "Test pack",
  "version": 1,
  "tasks": [
    {
      "id": "task-aaaa",
      "prompt": "Say hello.",
      "allowedTools": ["list_directory"],
      "deniedTools": ["execute_command"],
      "rubricPrompt": "Score 100 if hello. JSON: {\\"score\\":number,\\"pass\\":boolean,\\"rationale\\":string}"
    }
  ]
}`;

describe('validateEvalPack', () => {
  it('accepts valid pack', () => {
    const pack = validateEvalPack(JSON.parse(VALID_PACK));
    assert.equal(pack.id, 'pack-11111111');
    assert.equal(pack.tasks.length, 1);
    assert.equal(pack.tasks[0].id, 'task-aaaa');
  });

  it('rejects invalid pack id', () => {
    const raw = JSON.parse(VALID_PACK);
    raw.id = 'Bad Id';
    assert.throws(() => validateEvalPack(raw), /invalid/i);
  });

  it('rejects unknown tool id', () => {
    const raw = JSON.parse(VALID_PACK);
    raw.tasks[0].allowedTools = ['not_a_real_tool_xyz'];
    assert.throws(() => validateEvalPack(raw), /unknown tool/i);
  });
});
