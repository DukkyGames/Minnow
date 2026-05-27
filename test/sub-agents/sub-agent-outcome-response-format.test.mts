import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildSubAgentOutcomeResponseFormat } from '../../src/agents/sub-agent-outcome-response-format.ts';

describe('sub-agent outcome response format', () => {
  test('buildSubAgentOutcomeResponseFormat returns json_schema wrapper', () => {
    const rf = buildSubAgentOutcomeResponseFormat('minnow.sub-agent.v1');
    assert.ok(rf);
    assert.equal(rf.type, 'json_schema');
    assert.equal(rf.json_schema.name, 'minnow_sub_agent_outcome');
    assert.equal(rf.json_schema.strict, false);
    const schema = rf.json_schema.schema as {
      type?: string;
      required?: string[];
    };
    assert.equal(schema.type, 'object');
    assert.deepEqual(schema.required, ['summary', 'findings', 'artifacts']);
  });
});
