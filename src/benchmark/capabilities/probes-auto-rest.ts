/**
 * Auto probe specs — code, web, agents, knowledge, apps, modes, features.
 */

import { hasTool, pass, partial, fail } from './probe-helpers.ts';
import type { CapabilityProbeSpec } from './types.ts';

export const REMAINING_AUTO_PROBES: Record<string, CapabilityProbeSpec> = {
  'code-execute-command': {
    kind: 'tool-call',
    toolIds: ['execute_command'],
    requires: ['workspace', 'tool-server'],
    verdict: (out) =>
      hasTool(out.toolCalls, 'execute_command') ? pass('execute_command called') : fail('No execute_command'),
  },
  'code-background-cmds': {
    kind: 'tool-call',
    toolIds: ['execute_command'],
    requires: ['workspace', 'tool-server'],
    verdict: (out) => {
      const bg = out.toolCalls.some((c) => {
        if (c.function.name !== 'execute_command') return false;
        try {
          const args = JSON.parse(c.function.arguments) as { background?: boolean };
          return args.background === true;
        } catch {
          return false;
        }
      });
      return bg ? pass('Background execute_command') : partial('execute_command without background flag');
    },
  },
  'code-run-js-py': {
    kind: 'tool-call',
    toolIds: ['run_python', 'run_javascript'],
    requires: ['workspace', 'tool-server'],
    verdict: (out) =>
      hasTool(out.toolCalls, 'run_python') || hasTool(out.toolCalls, 'run_javascript')
        ? pass('run_python or run_javascript called')
        : fail('Expected run_python/javascript'),
  },
  'code-command-log': {
    kind: 'tool-chain',
    maxToolRounds: 4,
    toolIds: ['read_command_log', 'stop_command'],
    requires: ['workspace', 'tool-server'],
    verdict: (out) => {
      const log = hasTool(out.toolCalls, 'read_command_log');
      const stop = hasTool(out.toolCalls, 'stop_command');
      if (log && stop) return pass('read_command_log and stop_command');
      if (log) return partial('read_command_log without stop');
      return fail('Expected command log tools');
    },
  },
  'code-repo-intel': {
    kind: 'tool-call',
    toolIds: ['repo_map', 'find_symbol'],
    requires: ['workspace'],
    verdict: (out) =>
      hasTool(out.toolCalls, 'repo_map') || hasTool(out.toolCalls, 'find_symbol')
        ? pass('Code intel tool called')
        : fail('Expected repo_map or find_symbol'),
  },
  'lsp-diagnostics': {
    kind: 'tool-call',
    toolIds: ['get_lsp_diagnostics', 'list_lsp_servers'],
    requires: ['lsp'],
    verdict: (out) =>
      hasTool(out.toolCalls, 'get_lsp_diagnostics') || hasTool(out.toolCalls, 'list_lsp_servers')
        ? pass('LSP tool called')
        : fail('Expected LSP diagnostics tool'),
  },
  'web-search': {
    kind: 'tool-call',
    toolIds: ['web_search'],
    emitOnly: true,
    verdict: (out) =>
      hasTool(out.toolCalls, 'web_search') ? pass('web_search emitted') : fail('No web_search emit'),
  },
  'web-fetch': {
    kind: 'tool-call',
    toolIds: ['fetch_web_content', 'rag_web_content'],
    emitOnly: true,
    verdict: (out) =>
      hasTool(out.toolCalls, 'fetch_web_content') || hasTool(out.toolCalls, 'rag_web_content')
        ? pass('Fetch tool emitted')
        : fail('No fetch_web_content emit'),
  },
  'web-wikipedia': {
    kind: 'tool-call',
    toolIds: ['wikipedia_search'],
    emitOnly: true,
    verdict: (out) =>
      hasTool(out.toolCalls, 'wikipedia_search') ? pass('wikipedia_search emitted') : fail('No wikipedia_search'),
  },
  'agents-todo-write': {
    kind: 'derived',
    maxToolRounds: 6,
    toolIds: ['todo_write'],
    verdict: (out) => {
      const rounds = out.rounds.filter((r) => r.toolCalls.some((c) => c.function.name === 'todo_write')).length;
      if (rounds >= 2) return pass('todo_write updated across rounds');
      if (rounds === 1) return partial('todo_write once only');
      return fail('No todo_write calls');
    },
  },
  'agents-spawn-sub-agent': {
    kind: 'tool-call',
    toolIds: ['spawn_sub_agent'],
    emitOnly: true,
    verdict: (out) =>
      hasTool(out.toolCalls, 'spawn_sub_agent') ? pass('spawn_sub_agent emitted') : fail('No spawn_sub_agent'),
  },
  'agents-delegate-tasks': {
    kind: 'tool-call',
    toolIds: ['delegate_tasks'],
    emitOnly: true,
    verdict: (out) =>
      hasTool(out.toolCalls, 'delegate_tasks') ? pass('delegate_tasks emitted') : fail('No delegate_tasks'),
  },
  'agents-issue-tools': {
    kind: 'tool-call',
    toolIds: ['issue_create', 'issue_update', 'issue_list'],
    emitOnly: true,
    verdict: (out) => {
      const issue = out.toolCalls.some((c) => c.function.name.startsWith('issue_'));
      return issue ? pass('issue_* tool emitted') : fail('No issue_* emit');
    },
  },
  'knowledge-brain-read': {
    kind: 'tool-call',
    toolIds: ['brain_search', 'brain_read_page', 'brain_list_pages'],
    emitOnly: true,
    verdict: (out) => {
      const brain = out.toolCalls.some((c) =>
        ['brain_search', 'brain_read_page', 'brain_list_pages'].includes(c.function.name),
      );
      return brain ? pass('Brain read tool emitted') : fail('No brain read tool');
    },
  },
  'knowledge-brain-write': {
    kind: 'tool-call',
    toolIds: ['brain_write_page', 'brain_append_log', 'brain_ingest'],
    emitOnly: true,
    verdict: (out) => {
      const write = out.toolCalls.some((c) =>
        ['brain_write_page', 'brain_append_log', 'brain_ingest'].includes(c.function.name),
      );
      return write ? pass('Brain write tool emitted') : fail('No brain write tool');
    },
  },
  'knowledge-minnow-docs': {
    kind: 'tool-call',
    toolIds: ['minnow_docs_search', 'minnow_docs_read'],
    emitOnly: true,
    verdict: (out) => {
      const docs = out.toolCalls.some((c) => c.function.name.startsWith('minnow_docs_'));
      return docs ? pass('minnow_docs_* emitted') : fail('No minnow_docs tool');
    },
  },
  'knowledge-save-memory': {
    kind: 'tool-call',
    toolIds: ['save_memory'],
    emitOnly: true,
    verdict: (out) =>
      hasTool(out.toolCalls, 'save_memory') ? pass('save_memory emitted') : fail('No save_memory'),
  },
  'apps-settings-appearance': {
    kind: 'tool-call',
    toolIds: ['update_settings', 'update_appearance'],
    emitOnly: true,
    verdict: (out) => {
      const settings = hasTool(out.toolCalls, 'update_settings') || hasTool(out.toolCalls, 'update_appearance');
      return settings ? pass('Settings/appearance tool emitted') : fail('No settings tool emit');
    },
  },
  'mode-set-chat-mode': {
    kind: 'tool-call',
    toolIds: ['set_chat_mode', 'propose_mode_switch'],
    emitOnly: true,
    verdict: (out) =>
      hasTool(out.toolCalls, 'set_chat_mode') || hasTool(out.toolCalls, 'propose_mode_switch')
        ? pass('Mode switch tool emitted')
        : fail('No mode switch emit'),
  },
  'mode-create-chat': {
    kind: 'tool-call',
    toolIds: ['create_chat_with_mode', 'launch_minnow_app'],
    emitOnly: true,
    verdict: (out) => {
      const launch =
        hasTool(out.toolCalls, 'create_chat_with_mode') || hasTool(out.toolCalls, 'launch_minnow_app');
      return launch ? pass('Chat/app launch tool emitted') : fail('No create_chat/launch emit');
    },
  },
  'mode-impeccable': {
    kind: 'derived',
    maxToolRounds: 4,
    verdict: (out) => {
      const skillLoad = out.text.toLowerCase().includes('impeccable') || out.text.includes('/impeccable');
      const toolFirst = out.rounds[0]?.toolCalls.length > 0;
      if (skillLoad && !toolFirst) return pass('Impeccable referenced before tools');
      if (skillLoad) return partial('Impeccable mentioned alongside early tool calls');
      return fail('No Impeccable context signal');
    },
  },
  'modes-general': {
    kind: 'text',
    verdict: (out) => {
      if (!out.text.trim()) return fail('Empty response');
      if (out.text.length > 4000) return partial('Very long general-mode reply');
      return pass('Coherent general-mode reply');
    },
  },
  'features-chat-title': {
    kind: 'text',
    verdict: (out) => {
      const t = out.text.trim();
      if (!t) return fail('Empty title');
      if (t.startsWith('{') || t.includes('```')) return fail('Title looks like JSON or fence');
      if (t.length > 120) return partial('Long chat title');
      return pass('Sensible title shape');
    },
  },
  'features-skills': {
    kind: 'delegated',
    suiteId: 'skills',
    testId: 'skill-impeccable',
  },
  'features-markdown': {
    kind: 'text',
    verdict: (out) => {
      const fences = (out.text.match(/```/g) ?? []).length;
      if (fences % 2 !== 0) return fail('Unclosed code fence');
      if (fences >= 2 && !/```\w+/.test(out.text)) return partial('Fences without language tags');
      return pass('Markdown fences well formed');
    },
  },
};
