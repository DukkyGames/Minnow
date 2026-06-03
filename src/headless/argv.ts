/**
 * CLI argument parsing for `minnow run` (Node parseArgs).
 */

import { parseArgs } from 'node:util';
import { MAX_CHAT_MAX_TOOL_TURNS } from '../config/chat-meta';

export interface HeadlessRunCliOptions {
  prompt: string;
  stdin: boolean;
  baseUrl: string;
  startServer: boolean;
  serverTimeoutSec: number;
  agentId: string | null;
  modeId: string;
  providerId: string | null;
  modelId: string | null;
  workspace: string | null;
  profile: string;
  minnowHome: string | null;
  noApproval: boolean;
  json: boolean;
  jsonOut: string | null;
  quiet: boolean;
  maxToolTurns: number | null;
  autoRejectQuestions: boolean;
}

const RUN_HELP = `minnow run — execute one agent turn without the SPA

Required:
  --prompt <text>       User task (or --stdin to read from stdin)

Server:
  --base-url <url>      Dev server origin (default http://127.0.0.1:5173)
  --start-server        Spawn "node server.js" with BROWSER=none if ping fails
  --server-timeout <s>  Preflight wait in seconds (default 30)

Agent / model:
  --agent <id>          Work agent id (e.g. builder, planner)
  --mode <id>           build | plan | orchestrate | research | reef (default build)
  --provider <id>       Override provider id
  --model <id>          Override model id

Environment:
  --workspace <path>    PUT /api/workspace before run (absolute or cwd-relative)
  --profile <name>      full | lite | custom:<configId>
  --minnow-home <path>  MINNOW_HOME for --start-server child (tests)

Safety:
  --no-approval         Auto-allow tools that would show a modal (requires env below)
  --auto-reject-questions  Return non-interactive error for ask_question (default)

Output:
  --json                Print HeadlessRunResult JSON to stdout
  --json-out <file>     Write JSON artifact to path
  --quiet               Only final assistant text on stdout (logs on stderr)

Limits:
  --max-tool-turns <n>  Cap tool rounds for this run (1–${MAX_CHAT_MAX_TOOL_TURNS})

Env:
  MINNOW_I_UNDERSTAND_UNSAFE_AUTOMATION=1  Required with --no-approval
  BROWSER=none                             Use with npm start in CI
  MINNOW_HEADLESS=1                          Skips browser open in server.js

Exit codes:
  0 success | 1 run failed | 2 usage | 3 server unavailable | 4 workspace invalid | 130 SIGINT
`;

export function printRunHelp(): void {
  process.stderr.write(RUN_HELP);
}

export function printTopLevelHelp(): void {
  process.stderr.write(`Minnow headless CLI

Usage:
  minnow run [options]     Run one agent turn (see: minnow run --help)

Examples:
  minnow run --prompt "Summarize README.md" --workspace .
  BROWSER=none npm start &
  minnow run --base-url http://127.0.0.1:5173 --prompt "Reply OK" --json
`);
}

/** Parse `run` subcommand argv (after "run" is stripped). */
export function parseRunArgs(argv: string[]): { ok: true; options: HeadlessRunCliOptions } | { ok: false; message: string } {
  if (argv.includes('--help') || argv.includes('-h')) {
    printRunHelp();
    return { ok: false, message: 'help' };
  }

  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      prompt: { type: 'string' },
      stdin: { type: 'boolean', default: false },
      'base-url': { type: 'string', default: 'http://127.0.0.1:5173' },
      'start-server': { type: 'boolean', default: false },
      'server-timeout': { type: 'string', default: '30' },
      agent: { type: 'string' },
      mode: { type: 'string', default: 'build' },
      provider: { type: 'string' },
      model: { type: 'string' },
      workspace: { type: 'string' },
      profile: { type: 'string', default: 'full' },
      'minnow-home': { type: 'string' },
      'no-approval': { type: 'boolean', default: false },
      'auto-reject-questions': { type: 'boolean', default: true },
      json: { type: 'boolean', default: false },
      'json-out': { type: 'string' },
      quiet: { type: 'boolean', default: false },
      'max-tool-turns': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length > 0) {
    return { ok: false, message: `Unexpected arguments: ${positionals.join(' ')}` };
  }

  let prompt = typeof values.prompt === 'string' ? values.prompt.trim() : '';
  if (values.stdin) {
    // Filled by cli-main after parse when stdin flag is set.
    prompt = prompt || '__STDIN__';
  }
  if (!prompt || prompt === '__STDIN__') {
    if (!values.stdin && !values.prompt) {
      return { ok: false, message: 'Missing required --prompt or --stdin' };
    }
  }

  const serverTimeoutSec = Math.max(1, parseInt(String(values['server-timeout'] ?? '30'), 10) || 30);

  let maxToolTurns: number | null = null;
  if (values['max-tool-turns'] != null) {
    const n = parseInt(String(values['max-tool-turns']), 10);
    if (!Number.isFinite(n) || n < 1 || n > MAX_CHAT_MAX_TOOL_TURNS) {
      return {
        ok: false,
        message: `--max-tool-turns must be an integer between 1 and ${MAX_CHAT_MAX_TOOL_TURNS}`,
      };
    }
    maxToolTurns = n;
  }

  const profile = String(values.profile ?? 'full').trim();
  if (
    profile !== 'full' &&
    profile !== 'lite' &&
    !profile.startsWith('custom:')
  ) {
    return {
      ok: false,
      message: '--profile must be full, lite, or custom:<configId>',
    };
  }

  const modeId = String(values.mode ?? 'build').trim().toLowerCase();
  if (modeId === 'orchestrate') {
    return {
      ok: false,
      message:
        'Orchestrate mode is not supported in headless v1 (board UI required). Use build or plan.',
    };
  }

  return {
    ok: true,
    options: {
      prompt,
      stdin: Boolean(values.stdin),
      baseUrl: String(values['base-url'] ?? 'http://127.0.0.1:5173').trim(),
      startServer: Boolean(values['start-server']),
      serverTimeoutSec,
      agentId: values.agent ? String(values.agent).trim() : null,
      modeId,
      providerId: values.provider ? String(values.provider).trim() : null,
      modelId: values.model ? String(values.model).trim() : null,
      workspace: values.workspace ? String(values.workspace).trim() : null,
      profile,
      minnowHome: values['minnow-home'] ? String(values['minnow-home']).trim() : null,
      noApproval: Boolean(values['no-approval']),
      json: Boolean(values.json),
      jsonOut: values['json-out'] ? String(values['json-out']).trim() : null,
      quiet: Boolean(values.quiet),
      maxToolTurns,
      autoRejectQuestions: values['auto-reject-questions'] !== false,
    },
  };
}
