/**
 * Auto probe specs — core protocol and files/git/docs bands.
 */

import {
  fail,
  hasTool,
  maxRoundBatchSize,
  parseToolArgs,
  pass,
  partial,
  streamVerdict,
  totalToolRounds,
} from './probe-helpers.ts';
import type { CapabilityProbeSpec } from './types.ts';

export const CORE_AND_FILES_PROBES: Record<string, CapabilityProbeSpec> = {
  'core-streaming': {
    kind: 'stream',
    verdict: streamVerdict,
  },
  'core-tool-calling': {
    kind: 'tool-call',
    toolIds: ['get_datetime'],
    expectTools: ['get_datetime'],
    verdict: (out) =>
      hasTool(out.toolCalls, 'get_datetime')
        ? pass('Emitted get_datetime')
        : fail('Expected get_datetime tool call'),
  },
  'core-parallel-tools': {
    kind: 'derived',
    maxToolRounds: 2,
    toolIds: ['read_file'],
    requires: ['workspace'],
    verdict: (out) => {
      const batch = maxRoundBatchSize(out);
      if (batch >= 3) return pass('Three or more parallel read_file calls');
      if (batch === 2) return partial('Two read_file calls in one batch');
      if (batch === 1 && out.rounds.some((r) => r.toolCalls.length > 0)) {
        return partial('Serial read_file calls only');
      }
      return fail('No read_file batch observed');
    },
  },
  'core-tool-loop': {
    kind: 'tool-chain',
    maxToolRounds: 8,
    requires: ['workspace', 'git-fixture'],
    verdict: (out) => {
      const rounds = totalToolRounds(out);
      if (rounds >= 4) return pass('Four or more tool rounds');
      if (rounds >= 2) return partial('Short tool chain');
      return fail('Tool loop did not continue');
    },
  },
  'core-json-args': {
    kind: 'derived',
    maxToolRounds: 3,
    verdict: (out) => {
      for (const round of out.rounds) {
        for (const call of round.toolCalls) {
          if (parseToolArgs(call) === null) {
            return fail(`Invalid JSON args for ${call.function.name}`);
          }
        }
      }
      if (out.toolCalls.length === 0) return fail('No tool calls to validate');
      return pass('Tool arguments parsed as JSON');
    },
  },
  'core-no-hallucinated-tools': {
    kind: 'derived',
    maxToolRounds: 2,
    verdict: (out) => {
      if (out.toolCalls.length === 0) return partial('No tool calls emitted');
      return pass('Tool calls emitted without runtime catalog validation');
    },
  },
  'core-system-prompt': {
    kind: 'text',
    verdict: (out) => {
      const t = out.text.trim();
      if (!t) return fail('Empty response');
      if (/^(sure|here is|as an ai)/i.test(t)) return partial('Preamble detected');
      return pass('Response without obvious preamble');
    },
  },
  'core-long-context': {
    kind: 'text',
    requires: ['workspace'],
    verdict: (out) => {
      const t = out.text.toLowerCase();
      if (t.includes('needle-marker-cap-matrix')) return pass('Recalled haystack needle');
      if (t.includes('truncat') || t.includes('too long')) return partial('Model reported context limits');
      return fail('Did not recall long-context needle');
    },
  },
  'core-vision': {
    kind: 'delegated',
    suiteId: 'capability',
    testId: 'cap-multimodal',
    requires: ['vision'],
  },
  'core-reasoning': {
    kind: 'derived',
    verdict: (out) => {
      if (/|<think|\[thinking\]/i.test(out.text)) {
        return partial('Thinking markup visible in answer text');
      }
      return pass('No leaked thinking markup in visible text');
    },
  },
  'files-list-read': {
    kind: 'tool-chain',
    maxToolRounds: 4,
    toolIds: ['list_directory', 'read_file'],
    requires: ['workspace'],
    verdict: (out) => {
      const listed = hasTool(out.toolCalls, 'list_directory');
      const read = hasTool(out.toolCalls, 'read_file');
      if (listed && read) return pass('list_directory and read_file called');
      if (read) return partial('read_file without list_directory');
      return fail('Expected directory listing and read');
    },
  },
  'files-read-document': {
    kind: 'tool-call',
    toolIds: ['read_document'],
    requires: ['workspace'],
    verdict: (out) =>
      hasTool(out.toolCalls, 'read_document') ? pass('read_document called') : fail('No read_document call'),
  },
  'files-save-append': {
    kind: 'tool-chain',
    maxToolRounds: 4,
    toolIds: ['save_file', 'append_file'],
    requires: ['workspace'],
    verdict: (out) => {
      const saved = hasTool(out.toolCalls, 'save_file');
      const appended = hasTool(out.toolCalls, 'append_file');
      if (saved && appended) return pass('save_file and append_file called');
      if (saved) return partial('save_file without append');
      return fail('Expected save and append sequence');
    },
  },
  'files-replace-text': {
    kind: 'tool-chain',
    maxToolRounds: 5,
    toolIds: ['replace_text_in_file', 'save_file'],
    requires: ['workspace'],
    verdict: (out) => {
      const replaceRounds = out.rounds.filter((r) =>
        r.toolCalls.some((c) => c.function.name === 'replace_text_in_file'),
      ).length;
      const saveOnly = hasTool(out.toolCalls, 'save_file') && !hasTool(out.toolCalls, 'replace_text_in_file');
      if (replaceRounds === 1 && hasTool(out.toolCalls, 'replace_text_in_file')) {
        return pass('replace_text_in_file succeeded on first round');
      }
      if (replaceRounds >= 2 && replaceRounds <= 3) {
        return partial('replace_text_in_file needed multiple rounds');
      }
      if (saveOnly) return fail('Rewrote file with save_file instead of replace');
      return fail('No successful replace_text_in_file');
    },
  },
  'files-insert-range': {
    kind: 'tool-chain',
    maxToolRounds: 4,
    toolIds: ['read_file_range', 'insert_at_line'],
    requires: ['workspace'],
    verdict: (out) => {
      const range = hasTool(out.toolCalls, 'read_file_range');
      const insert = hasTool(out.toolCalls, 'insert_at_line');
      if (range && insert) return pass('read_file_range and insert_at_line called');
      return fail('Expected range read then insert');
    },
  },
  'files-grep': {
    kind: 'tool-call',
    toolIds: ['grep', 'find_files'],
    requires: ['workspace'],
    verdict: (out) =>
      hasTool(out.toolCalls, 'grep') || hasTool(out.toolCalls, 'find_files')
        ? pass('Search tool called')
        : fail('Expected grep or find_files'),
  },
  'docs-create-office': {
    kind: 'tool-call',
    toolIds: ['create_spreadsheet', 'create_pdf', 'create_word_document'],
    requires: ['workspace'],
    verdict: (out) => {
      const office = out.toolCalls.some((c) =>
        ['create_spreadsheet', 'create_pdf', 'create_word_document'].includes(c.function.name),
      );
      return office ? pass('Office document tool called') : fail('No document creation tool');
    },
  },
  'git-read': {
    kind: 'tool-call',
    toolIds: ['git_status', 'git_diff', 'git_log'],
    requires: ['workspace', 'git-fixture'],
    verdict: (out) => {
      const read = out.toolCalls.some((c) =>
        ['git_status', 'git_diff', 'git_log'].includes(c.function.name),
      );
      return read ? pass('Git read tool called') : fail('Expected git_status/diff/log');
    },
  },
  'git-write': {
    kind: 'tool-chain',
    maxToolRounds: 6,
    toolIds: ['git_add', 'git_commit', 'git_branch'],
    requires: ['workspace', 'git-fixture'],
    emitOnly: true,
    verdict: (out) => {
      const write = out.toolCalls.some((c) =>
        ['git_add', 'git_commit', 'git_branch'].includes(c.function.name),
      );
      return write ? pass('Git write tool emitted') : fail('Expected git add/commit/branch emit');
    },
  },
};
