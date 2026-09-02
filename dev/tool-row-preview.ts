import '../src/styles/fonts.css';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
import '../src/styles/motion.css';
import '../src/styles/icons.css';
import '../src/styles/messages.css';
import '../src/styles/code-change-strip.css';
import '../src/styles/tool-call-diff.css';

import { renderToolCall, renderToolResult } from '../src/ui/tool-messages';
import type { CodeChangeStats } from '../src/types';

const stage = document.getElementById('stage')!;

function heading(text: string): void {
  const h = document.createElement('h2');
  h.textContent = text;
  stage.appendChild(h);
}

function row(
  name: string,
  args: Record<string, unknown>,
  result?: string,
  codeChange?: CodeChangeStats,
): HTMLElement {
  const wrap = renderToolCall(name, args);
  stage.appendChild(wrap);
  if (result !== undefined) renderToolResult(wrap, result, undefined, args, codeChange);
  return wrap;
}

function open(wrap: HTMLElement): HTMLElement {
  wrap.querySelector('details')?.setAttribute('open', '');
  return wrap;
}

heading('Collapsed — a run of calls');
row('list_directory', { path: '.' }, '[dir] .git\n[file] .gitignore\n[file] README.md');
row('read_file', { path: 'src/ui/tool-call-presentation.ts' }, Array.from({ length: 402 }, (_, i) => `line ${i}`).join('\n'));
row('read_file_range', { path: 'src/styles/messages.css', start_line: 648, end_line: 700 }, Array.from({ length: 53 }, (_, i) => `line ${i}`).join('\n'));
row('grep', { pattern: 'tool-call-' }, 'src/ui/tool-messages.ts:24:const A\nsrc/ui/tool-messages.ts:88:const B\nsrc/styles/messages.css:651:.tool-call-msg');
row('find_files', { pattern: '**/*.test.mjs' }, 'test/ui/a.test.mjs\ntest/ui/b.test.mjs\ntest/api/c.test.mjs');
row('execute_command', { command: 'npm test -- test/ui' }, 'npm test (exit 0)\n\nstdout:\nall suites passed\n');
row('git_status', {}, '## main...origin/main\n M src/ui/tool-messages.ts\n M src/styles/messages.css\n?? dev/tool-row-preview.ts');
row('git_log', { count: 3 }, 'git log (exit 0)\n\nstdout:\n682f73c refactor desktop session restoration\n5f851a0 enhance prompt expansion\n403c043 update icon names');
row('git_commit', { message: 'Redesign tool-call rows' }, '[main 9c1f2ab] Redesign tool-call rows\n 3 files changed');
row('web_search', { query: 'oklch color space browser support' }, 'result body');
row('read_file', { path: 'a/deeply/nested/path/that/keeps/going/for/a/while/component.tsx' }, 'x\ny');

heading('Running');
row('execute_command', { command: 'npm run build' });
row('read_file', { path: 'package.json' });

heading('Failed');
row('read_file', { path: 'test/sample-project.md' }, "Error: ENOENT: no such file or directory, stat 'test/sample-project.md'");
row('execute_command', { command: 'npm run typecheck' }, 'Error: npm run typecheck (exit 1)\n\nstdout:\n2 errors');

heading('Expanded — directory listing');
open(row('list_directory', { path: 'src/ui' }, '[dir] email\n[dir] os\n[file] icon.ts\n[file] messages.ts\n[file] tool-messages.ts'));

heading('Expanded — search matches');
open(row('grep', { pattern: 'renderToolRow', path: 'src' }, 'src/ui/tool-messages.ts:12:import { buildToolRow } from\nsrc/ui/tool-messages.ts:240:function paintRow(\nsrc/ui/tool-call-presentation.ts:501:export function buildToolRow('));

heading('Expanded — shell');
open(row('execute_command', { command: 'git status --porcelain', timeout_ms: 30000 }, 'git status (exit 0)\n\nstdout:\n M src/ui/tool-messages.ts\n?? dev/tool-row-preview.ts\n'));

heading('Expanded — ask_question');
open(row(
  'ask_question',
  {
    questions: [
      {
        id: 'q_grill',
        prompt: 'Want me to ask a few clarifying questions first to sharpen scope?',
        options: [
          { id: 'yes', label: 'Yes — ask me a few questions' },
          { id: 'no', label: 'No — just draft a plan with reasonable defaults' },
        ],
      },
    ],
  },
  JSON.stringify({ status: 'answered', answers: [{ questionId: 'q_grill', selectedIds: ['yes'] }] }),
));

heading('Expanded — failure');
open(row('read_file', { path: 'test/sample-project.md', encoding: 'utf8' }, "Error: ENOENT: no such file or directory, stat 'test/sample-project.md'"));

heading('Expanded — unmapped tool falls back to readable fields');
open(row(
  'manage_dev_servers',
  { action: 'restart', id: 'primary', worktree_root: 'C:/repos/minnow' },
  '{"ok":true,"status":"listening","port":5173}',
));

heading('File mutation card');
row('save_file', { path: 'src/ui/tool-call-presentation.ts' }, 'Saved', {
  additions: 42,
  deletions: 7,
  path: 'src/ui/tool-call-presentation.ts',
  diffLines: [
    { type: 'unchanged', text: 'export function getToolIcon(toolName: string): IconName {' },
    { type: 'remove', text: "  const category = TOOL_CATEGORY_BY_ID.get(toolName) ?? 'utility';" },
    { type: 'add', text: '  const dedicated = TOOL_ICON[toolName];' },
    { type: 'add', text: '  if (dedicated) return dedicated;' },
  ],
});
