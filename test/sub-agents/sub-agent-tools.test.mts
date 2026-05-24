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
      name: 'list_sub_agents',
      description: 'list',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_sub_agent_status',
      description: 'status',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'web',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_datetime',
      description: 'dt',
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
      deniedTools: ['spawn_sub_agent', 'list_sub_agents', 'get_sub_agent_status'],
      systemPromptPath: null,
    };
    const tools = resolveSubAgentTools(cfg, 'generalPurpose', parentEnabled);
    assert.ok(!tools.some((t) => t.function.name === 'spawn_sub_agent'));
    assert.ok(!tools.some((t) => t.function.name === 'list_sub_agents'));
    assert.ok(!tools.some((t) => t.function.name === 'get_sub_agent_status'));
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
      deniedTools: ['spawn_sub_agent', 'list_sub_agents', 'get_sub_agent_status', 'execute_command'],
      systemPromptPath: null,
    };
    const tools = resolveSubAgentTools(cfg, 'explore', parentEnabled);
    assert.ok(!tools.some((t) => t.function.name === 'execute_command'));
  });

  test('researcher excludes execute_command and spawn_sub_agent', () => {
    const cfg: SubAgentTypeConfig = {
      enabled: true,
      providerId: 'lm-studio-local',
      modelId: '',
      maxConcurrent: 5,
      timeoutMs: 420000,
      maxToolTurns: 16,
      workAgentId: null,
      allowedTools: [
        'get_datetime',
        'web_search',
        'wikipedia_search',
        'fetch_web_content',
        'rag_web_content',
        'read_file',
        'read_file_range',
        'find_files',
        'search_in_file',
        'list_directory',
      ],
      deniedTools: [
        'spawn_sub_agent',
        'cancel_sub_agent',
        'execute_command',
        'save_file',
        'append_file',
        'insert_at_line',
        'replace_text_in_file',
        'delete_path',
        'move_file',
        'git_commit',
        'git_add',
        'git_push',
      ],
      systemPromptPath: null,
    };
    const tools = resolveSubAgentTools(cfg, 'researcher', parentEnabled);
    assert.ok(!tools.some((t) => t.function.name === 'execute_command'));
    assert.ok(!tools.some((t) => t.function.name === 'spawn_sub_agent'));
    assert.ok(tools.some((t) => t.function.name === 'web_search'));
    assert.ok(tools.some((t) => t.function.name === 'get_datetime'));
  });
});
