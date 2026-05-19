import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveSubAgentTools } from '../../src/agents/sub-agent-tools.ts';
import type { SubAgentTypeConfig } from '../../src/agents/types.ts';

const parentEnabled = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'read',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'execute_command',
      description: 'run',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'spawn_sub_agent',
      description: 'spawn',
      parameters: { type: 'object', properties: {} },
    },
  },
];

describe('resolveSubAgentTools', () => {
  test('whitelist limits tools', () => {
    const cfg: SubAgentTypeConfig = {
      enabled: true,
      providerId: 'lm-studio-local',
      modelId: '',
      maxConcurrent: 1,
      timeoutMs: 300000,
      workAgentId: null,
      allowedTools: ['read_file'],
      deniedTools: [],
      systemPromptPath: null,
    };
    const tools = resolveSubAgentTools(cfg, 'explore', parentEnabled);
    assert.deepEqual(
      tools.map((t) => t.function.name),
      ['read_file'],
    );
  });

  test('spawn tools excluded by default', () => {
    const cfg: SubAgentTypeConfig = {
      enabled: true,
      providerId: 'lm-studio-local',
      modelId: '',
      maxConcurrent: 1,
      timeoutMs: 300000,
      workAgentId: null,
      allowedTools: null,
      deniedTools: ['spawn_sub_agent'],
      systemPromptPath: null,
    };
    const tools = resolveSubAgentTools(cfg, 'generalPurpose', parentEnabled);
    assert.ok(!tools.some((t) => t.function.name === 'spawn_sub_agent'));
    assert.ok(tools.some((t) => t.function.name === 'read_file'));
  });

  test('explore cannot invoke execute_command when omitted from allow list', () => {
    const cfg: SubAgentTypeConfig = {
      enabled: true,
      providerId: 'lm-studio-local',
      modelId: '',
      maxConcurrent: 1,
      timeoutMs: 300000,
      workAgentId: null,
      allowedTools: ['read_file', 'list_directory'],
      deniedTools: ['spawn_sub_agent', 'execute_command'],
      systemPromptPath: null,
    };
    const tools = resolveSubAgentTools(cfg, 'explore', parentEnabled);
    assert.ok(!tools.some((t) => t.function.name === 'execute_command'));
  });
});
