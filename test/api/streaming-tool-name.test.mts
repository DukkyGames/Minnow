/**
 * Mid-stream tool name detection from SSE tool_calls deltas.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getLatestStreamingToolName } from '../../src/api/tool-call-stream.ts';
import type { ChatCompletionChunk, ToolCallAccumulator } from '../../src/types.ts';

/** Minimal merge for tests (mirrors mergeToolCallDelta in chat.ts). */
function mergeToolCallDelta(
  acc: ToolCallAccumulator,
  chunk: ChatCompletionChunk,
): ToolCallAccumulator {
  const deltas = chunk.choices?.[0]?.delta?.tool_calls;
  if (!deltas?.length) return acc;

  const next: ToolCallAccumulator = { ...acc };
  for (const d of deltas) {
    const idx = d.index;
    const existing = next[idx] || { type: 'function' as const, function: { name: '', arguments: '' } };
    const merged = {
      ...existing,
      type: 'function' as const,
      function: {
        name: existing.function?.name || '',
        arguments: existing.function?.arguments || '',
      },
    };
    if (d.id) merged.id = d.id;
    if (d.function?.name) {
      merged.function = {
        ...merged.function,
        name: (merged.function?.name || '') + d.function.name,
      };
    }
    if (d.function?.arguments) {
      merged.function = {
        ...merged.function,
        arguments: (merged.function?.arguments || '') + d.function.arguments,
      };
    }
    next[idx] = merged;
  }
  return next;
}

function toolNameChunk(
  index: number,
  name: string,
  id = `call_${index}`,
): ChatCompletionChunk {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              id,
              type: 'function',
              function: { name, arguments: '' },
            },
          ],
        },
      },
    ],
  };
}

function toolArgsChunk(index: number, argsFragment: string): ChatCompletionChunk {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              type: 'function',
              function: { arguments: argsFragment },
            },
          ],
        },
      },
    ],
  };
}

function proseChunk(text: string): ChatCompletionChunk {
  return {
    choices: [{ delta: { content: text } }],
  };
}

/** Mirror streamCompletionTurn callback gating for unit tests. */
function collectStreamingToolNames(chunks: ChatCompletionChunk[]): string[] {
  let acc: ToolCallAccumulator = {};
  let lastAnnounced = '';
  const names: string[] = [];
  for (const chunk of chunks) {
    acc = mergeToolCallDelta(acc, chunk);
    const streamingName = getLatestStreamingToolName(acc);
    if (streamingName && streamingName !== lastAnnounced) {
      lastAnnounced = streamingName;
      names.push(streamingName);
    }
  }
  return names;
}

describe('getLatestStreamingToolName', () => {
  test('returns null for empty accumulator', () => {
    assert.equal(getLatestStreamingToolName({}), null);
  });

  test('returns highest-index tool with a name', () => {
    let acc: ToolCallAccumulator = {};
    acc = mergeToolCallDelta(acc, toolNameChunk(0, 'read_file'));
    acc = mergeToolCallDelta(acc, toolNameChunk(1, 'list_dir'));
    assert.equal(getLatestStreamingToolName(acc), 'list_dir');
  });

  test('ignores entries with empty names', () => {
    let acc: ToolCallAccumulator = {};
    acc = mergeToolCallDelta(acc, toolArgsChunk(0, '{"path":'));
    assert.equal(getLatestStreamingToolName(acc), null);
    acc = mergeToolCallDelta(acc, toolNameChunk(0, 'read_file'));
    assert.equal(getLatestStreamingToolName(acc), 'read_file');
  });
});

describe('streaming tool name callback', () => {
  test('fires once per tool after prose then tool_calls delta', () => {
    const names = collectStreamingToolNames([
      proseChunk('Checking the file…'),
      toolNameChunk(0, 'read_file'),
      toolArgsChunk(0, '{"path":"README.md"}'),
    ]);
    assert.deepEqual(names, ['read_file']);
  });

  test('updates when a second sequential tool name appears', () => {
    const names = collectStreamingToolNames([
      toolNameChunk(0, 'read_file'),
      toolNameChunk(1, 'grep'),
    ]);
    assert.deepEqual(names, ['read_file', 'grep']);
  });
});
