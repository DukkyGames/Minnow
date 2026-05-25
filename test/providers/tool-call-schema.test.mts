import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildToolCallResponseFormat, MAX_TOOL_CALL_SCHEMA_BRANCHES } from '../../src/providers/tool-call-schema.ts';
import type { OpenAIFunctionDefinition } from '../../src/tools/definitions.ts';

function stubTool(name: string): OpenAIFunctionDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} tool`,
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  };
}

describe('buildToolCallResponseFormat', () => {
  it('returns null for empty tools', () => {
    assert.equal(buildToolCallResponseFormat([]), null);
  });

  it('builds enum const for a single tool', () => {
    const fmt = buildToolCallResponseFormat([stubTool('read_file')]);
    assert.ok(fmt);
    assert.equal(fmt.type, 'json_schema');
    const schema = fmt.json_schema.schema;
    const items = (schema.properties as Record<string, unknown>).tool_calls as Record<
      string,
      unknown
    >;
    const itemProps = (items.items as Record<string, unknown>).properties as Record<
      string,
      unknown
    >;
    const nameSchema = itemProps.name as Record<string, unknown>;
    assert.equal(nameSchema.const, 'read_file');
  });

  it('uses oneOf when multiple tools', () => {
    const fmt = buildToolCallResponseFormat([stubTool('read_file'), stubTool('save_file')]);
    assert.ok(fmt);
    const schema = fmt.json_schema.schema;
    const items = (schema.properties as Record<string, unknown>).tool_calls as Record<
      string,
      unknown
    >;
    const itemSchema = items.items as Record<string, unknown>;
    assert.ok(Array.isArray(itemSchema.oneOf));
    assert.equal((itemSchema.oneOf as unknown[]).length, 2);
  });

  it('caps branches at MAX_TOOL_CALL_SCHEMA_BRANCHES', () => {
    const tools = Array.from({ length: 12 }, (_, i) => stubTool(`tool_${i}`));
    const fmt = buildToolCallResponseFormat(tools);
    assert.ok(fmt);
    const schema = fmt.json_schema.schema;
    const items = (schema.properties as Record<string, unknown>).tool_calls as Record<
      string,
      unknown
    >;
    const itemSchema = items.items as Record<string, unknown>;
    const branches = itemSchema.oneOf as unknown[];
    assert.equal(branches.length, MAX_TOOL_CALL_SCHEMA_BRANCHES);
  });
});
