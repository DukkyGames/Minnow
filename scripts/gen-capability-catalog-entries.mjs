/**
 * One-off helper to emit catalog-entries.ts from the capability matrix workbook.
 * Regenerate if spreadsheet columns change (order must stay stable).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const ROOT = path.resolve(import.meta.dirname, '..');
const xlsxPath = path.join(ROOT, 'documentation/minnow-model-capability-matrix.xlsx');
const outPath = path.join(ROOT, 'src/benchmark/capabilities/catalog-entries.ts');

fs.mkdirSync(path.dirname(outPath), { recursive: true });

const GROUP_BY_HEADER_PREFIX = [
  { prefix: 'Streaming', group: 'core-protocol' },
  { prefix: 'Tool calling', group: 'core-protocol' },
  { prefix: 'Parallel tool', group: 'core-protocol' },
  { prefix: 'Multi-step', group: 'core-protocol' },
  { prefix: 'Valid JSON', group: 'core-protocol' },
  { prefix: 'No hallucinated', group: 'core-protocol' },
  { prefix: 'System prompt', group: 'core-protocol' },
  { prefix: 'Long context', group: 'core-protocol' },
  { prefix: 'Vision', group: 'core-protocol' },
  { prefix: 'Reasoning', group: 'core-protocol' },
  { prefix: 'list_directory', group: 'files' },
  { prefix: 'read_document', group: 'files' },
  { prefix: 'save_file', group: 'files' },
  { prefix: 'replace_text', group: 'files' },
  { prefix: 'insert_at_line', group: 'files' },
  { prefix: 'grep / find_files', group: 'files' },
  { prefix: 'create_pdf', group: 'docs' },
  { prefix: 'git_status', group: 'git' },
  { prefix: 'git_add', group: 'git' },
  { prefix: 'execute_command', group: 'code-shell' },
  { prefix: 'Background cmds', group: 'code-shell' },
  { prefix: 'run_javascript', group: 'code-shell' },
  { prefix: 'read_command_log', group: 'code-shell' },
  { prefix: 'Code intel', group: 'code-shell' },
  { prefix: 'get_lsp_diagnostics', group: 'lsp' },
  { prefix: 'web_search', group: 'web' },
  { prefix: 'fetch_web_content', group: 'web' },
  { prefix: 'wikipedia_search', group: 'web' },
  { prefix: 'navigate / tabs', group: 'browser' },
  { prefix: 'snapshot / click', group: 'browser' },
  { prefix: 'eval / screenshot', group: 'browser' },
  { prefix: 'todo_write', group: 'agents-tasks' },
  { prefix: 'spawn_sub_agent', group: 'agents-tasks' },
  { prefix: 'list / get / cancel sub-agents', group: 'agents-tasks' },
  { prefix: 'delegate_tasks', group: 'agents-tasks' },
  { prefix: 'board_init', group: 'agents-tasks' },
  { prefix: 'board_report', group: 'agents-tasks' },
  { prefix: 'issue_*', group: 'agents-tasks' },
  { prefix: 'brain_search', group: 'knowledge' },
  { prefix: 'brain_write_page', group: 'knowledge' },
  { prefix: 'minnow_docs_*', group: 'knowledge' },
  { prefix: 'save_memory', group: 'knowledge' },
  { prefix: 'recall_chat_context', group: 'knowledge' },
  { prefix: 'Email: list', group: 'apps' },
  { prefix: 'Email: draft_reply', group: 'apps' },
  { prefix: 'summarize_inbox', group: 'apps' },
  { prefix: 'manage_calendar', group: 'apps' },
  { prefix: 'Settings & appearance', group: 'apps' },
  { prefix: 'set_chat_mode', group: 'mode-control' },
  { prefix: 'create_chat_with_mode', group: 'mode-control' },
  { prefix: 'Impeccable', group: 'mode-control' },
  { prefix: 'General', group: 'modes' },
  { prefix: 'Build', group: 'modes' },
  { prefix: 'Plan', group: 'modes' },
  { prefix: 'Super Plan', group: 'modes' },
  { prefix: 'Orchestrate', group: 'modes' },
  { prefix: 'Debug', group: 'modes' },
  { prefix: 'Desktop', group: 'modes' },
  { prefix: 'Email', group: 'modes' },
  { prefix: 'Onboarding', group: 'modes' },
  { prefix: 'Research', group: 'features' },
  { prefix: 'Compare', group: 'features' },
  { prefix: 'Chat title', group: 'features' },
  { prefix: 'Skills / plugins', group: 'features' },
  { prefix: 'MCP servers', group: 'features' },
  { prefix: 'Voice', group: 'features' },
  { prefix: 'Markdown & code fences', group: 'features' },
];

const ID_BY_HEADER = {
  'Streaming': 'core-streaming',
  'Tool calling (basic)': 'core-tool-calling',
  'Parallel tool calls': 'core-parallel-tools',
  'Multi-step tool loop': 'core-tool-loop',
  'Valid JSON args': 'core-json-args',
  'No hallucinated tools': 'core-no-hallucinated-tools',
  'System prompt adherence': 'core-system-prompt',
  'Long context >32k': 'core-long-context',
  'Vision / image input': 'core-vision',
  'Reasoning / thinking': 'core-reasoning',
  'list_directory / read_file': 'files-list-read',
  'read_document': 'files-read-document',
  'save_file / append_file': 'files-save-append',
  'replace_text_in_file': 'files-replace-text',
  'insert_at_line / read_file_range': 'files-insert-range',
  'grep / find_files': 'files-grep',
  'create_pdf / spreadsheet / word': 'docs-create-office',
  'git_status / diff / log (read)': 'git-read',
  'git_add / commit / branch (write)': 'git-write',
  'execute_command': 'code-execute-command',
  'Background cmds / dev servers': 'code-background-cmds',
  'run_javascript / run_python': 'code-run-js-py',
  'read_command_log / stop_command': 'code-command-log',
  'Code intel (repo_map, find_symbol)': 'code-repo-intel',
  'get_lsp_diagnostics / list_lsp_servers': 'lsp-diagnostics',
  'web_search': 'web-search',
  'fetch_web_content / rag_web_content': 'web-fetch',
  'wikipedia_search': 'web-wikipedia',
  'navigate / tabs': 'browser-navigate',
  'snapshot / click / fill': 'browser-snapshot',
  'eval / screenshot': 'browser-eval',
  'todo_write': 'agents-todo-write',
  'spawn_sub_agent': 'agents-spawn-sub-agent',
  'list / get / cancel sub-agents': 'agents-sub-agent-control',
  'delegate_tasks': 'agents-delegate-tasks',
  'board_init / board_update_task': 'agents-board-init',
  'board_report / board_get_state': 'agents-board-report',
  'issue_* tools': 'agents-issue-tools',
  'brain_search / read_page / list': 'knowledge-brain-read',
  'brain_write_page / append_log / ingest': 'knowledge-brain-write',
  'minnow_docs_*': 'knowledge-minnow-docs',
  'save_memory': 'knowledge-save-memory',
  'recall_chat_context / recall_turn_full': 'knowledge-recall',
  'Email: list / search / get_thread': 'apps-email-list',
  'Email: draft_reply / email_action': 'apps-email-draft',
  'summarize_inbox / reply_variants': 'apps-email-summarize',
  'manage_calendar': 'apps-calendar',
  'Settings & appearance tools': 'apps-settings-appearance',
  'set_chat_mode / propose_mode_switch': 'mode-set-chat-mode',
  'create_chat_with_mode / launch app': 'mode-create-chat',
  'Impeccable / aesthetics': 'mode-impeccable',
  'General': 'modes-general',
  'Build': 'modes-build',
  'Plan': 'modes-plan',
  'Super Plan': 'modes-super-plan',
  'Orchestrate': 'modes-orchestrate',
  'Debug': 'modes-debug',
  'Desktop': 'modes-desktop',
  'Email': 'modes-email',
  'Onboarding': 'modes-onboarding',
  'Research': 'features-research',
  'Compare': 'features-compare',
  'Chat title generation': 'features-chat-title',
  'Skills / plugins': 'features-skills',
  'MCP servers': 'features-mcp',
  'Voice': 'features-voice',
  'Markdown & code fences': 'features-markdown',
};

const MANUAL_IDS = new Set([
  'browser-navigate',
  'browser-snapshot',
  'browser-eval',
  'agents-sub-agent-control',
  'agents-board-init',
  'agents-board-report',
  'knowledge-recall',
  'apps-email-list',
  'apps-email-draft',
  'apps-email-summarize',
  'apps-calendar',
  'modes-build',
  'modes-plan',
  'modes-super-plan',
  'modes-orchestrate',
  'modes-debug',
  'modes-desktop',
  'modes-email',
  'modes-onboarding',
  'features-research',
  'features-compare',
  'features-mcp',
  'features-voice',
]);

const MANUAL_REASONS = {
  'browser-navigate': 'Needs the Electron browser pane; headless driver cannot drive tabs.',
  'browser-snapshot': 'Needs live browser automation and snapshot refs in the Electron shell.',
  'browser-eval': 'Screenshot and eval probes require the embedded browser surface.',
  'agents-sub-agent-control': 'Requires an active sub-agent run to list, inspect, or cancel.',
  'agents-board-init': 'Orchestrate board seeding is a multi-turn UI workflow, not a one-shot probe.',
  'agents-board-report': 'Board completion reporting needs a live orchestration session.',
  'knowledge-recall': 'Needs a real chat session with many prior turns; headless driver has no session history.',
  'apps-email-list': 'Requires a connected email account and live mailbox data.',
  'apps-email-draft': 'Requires connected email; sending must stay manual-verified.',
  'apps-email-summarize': 'Requires connected email with enough threads to summarize.',
  'apps-calendar': 'Requires a connected calendar provider with real events.',
  'modes-build': 'Full Build mode task needs interactive review across many tool rounds.',
  'modes-plan': 'Plan mode guard behavior needs human judgment across a planning session.',
  'modes-super-plan': 'Super Plan pipeline stages need UI pause/resume/retry verification.',
  'modes-orchestrate': 'Board-driven orchestration cannot be scored in a single headless turn.',
  'modes-debug': 'Debug loop quality needs a failing test scenario and human follow-up.',
  'modes-desktop': 'Desktop tools require OS-level automation outside the benchmark sandbox.',
  'modes-email': 'Email mode is a full triage session, not a single prompt.',
  'modes-onboarding': 'Onboarding is a guided multi-step chat that must be walked end to end.',
  'features-research': 'Research runs are long-lived jobs with sources to inspect manually.',
  'features-compare': 'Compare sessions need two models side by side in the Compare app.',
  'features-mcp': 'MCP connectivity depends on user-configured servers and credentials.',
  'features-voice': 'Voice round trip needs microphone hardware and UI capture.',
};

function parseTier(comment) {
  const m = comment.match(/Tier (\d)/);
  return m ? Number(m[1]) : 2;
}

function parseHowToTest(comment) {
  const idx = comment.indexOf('How to test:');
  if (idx === -1) return comment.trim();
  return comment.slice(idx + 'How to test:'.length).trim();
}

function inferGroup(header) {
  for (const row of GROUP_BY_HEADER_PREFIX) {
    if (header.startsWith(row.prefix) || header.includes(row.prefix)) return row.group;
  }
  throw new Error(`no group for ${header}`);
}

function buildPrompt(howToTest, header) {
  const quoted = howToTest.match(/^'([^']+)'/);
  if (quoted) return quoted[1];
  if (howToTest.includes('->')) return howToTest.split('->')[0].trim().replace(/^Ask /i, '');
  if (howToTest.startsWith('Ask ')) return howToTest.slice(4).replace(/\.$/, '');
  return `Exercise: ${header}. ${howToTest}`;
}

const wb = XLSX.readFile(xlsxPath, { cellComments: true });
const sheet = wb.Sheets['Cloud'];
const range = XLSX.utils.decode_range(sheet['!ref']);
const entries = [];

for (let C = 10; C <= range.e.c; C++) {
  const addr = XLSX.utils.encode_cell({ r: 2, c: C });
  const cell = sheet[addr];
  if (!cell?.v) continue;
  const header = String(cell.v).trim();
  if (header === 'Blocking issues' || header === 'Notes') break;
  const comment = cell.c?.[0]?.t ?? '';
  const tier = parseTier(comment);
  const howToTest = parseHowToTest(comment);
  const id = ID_BY_HEADER[header];
  if (!id) throw new Error(`missing id for ${header}`);
  const group = inferGroup(header);
  const scoreMode = MANUAL_IDS.has(id) ? 'manual' : 'auto';
  const prompt = buildPrompt(howToTest, header);
  const setup =
    scoreMode === 'manual'
      ? 'Open Minnow with the target model active; use the capability matrix manual test path.'
      : 'Benchmark scratch workspace with tool server running; capability-matrix fixtures seeded when required.';
  const passCriteria =
    scoreMode === 'manual'
      ? 'Human marks ✅ works, ⚠️ partial, ❌ broken, or ➖ not applicable per the matrix legend.'
      : 'Automated probe returns pass, partial, or fail; n-a when requirements (vision, LSP, workspace) are missing.';

  entries.push({
    id,
    group,
    header,
    tier,
    scoreMode,
    howToTest,
    setup,
    prompt,
    passCriteria,
    manualReason: MANUAL_REASONS[id],
  });
}

if (entries.length !== 67) throw new Error(`expected 67 entries, got ${entries.length}`);
const autoCount = entries.filter((e) => e.scoreMode === 'auto').length;
if (autoCount !== 44) throw new Error(`expected 44 auto, got ${autoCount}`);

const lines = [
  '/**',
  ' * Spreadsheet-ordered capability metadata (no probe bindings).',
  ' * Generated by scripts/gen-capability-catalog-entries.mjs — do not hand-edit ids.',
  ' */',
  '',
  'import type { CapabilityGroupId, CapabilityScoreMode } from "./types.ts";',
  '',
  'export interface CapabilityCatalogEntry {',
  '  id: string;',
  '  group: CapabilityGroupId;',
  '  header: string;',
  '  tier: 1 | 2 | 3;',
  '  scoreMode: CapabilityScoreMode;',
  '  howToTest: string;',
  '  setup: string;',
  '  prompt: string;',
  '  passCriteria: string;',
  '  manualReason?: string;',
  '}',
  '',
  'export const CAPABILITY_CATALOG_ENTRIES: CapabilityCatalogEntry[] = ',
  JSON.stringify(entries, null, 2).replace(/"tier": (\d)/g, 'tier: $1'),
  ';',
  '',
];

fs.writeFileSync(outPath, lines.join('\n'));
console.log(`Wrote ${entries.length} entries to ${outPath}`);
