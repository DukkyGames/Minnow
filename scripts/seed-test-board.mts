#!/usr/bin/env node
/**
 * Seed a pre-initialized orchestrate test board into ~/.minnow sessions (SQLite).
 *
 * Usage:
 *   npm run seed:test-board [-- --workspace <path>] [--preset quick|smoke]
 *       [--mode manual|auto|sequential] [--provider fake-board]
 *       [--model fake-board-model] [--auto-start]
 *
 * Re-run safely: upserts the same planner chat + folder group by stable ids.
 * Restart Minnow (or re-open the workspace) if the app was already running.
 */

import { pathToFileURL } from 'node:url';
import { installHeadlessLocalStorage } from '../src/headless/server-context.ts';
import { normalizeWorkspacePath } from '../src/lib/normalize-workspace-path.ts';
import {
  buildTestBoardSession,
  type PresetId,
  type SeedTestBoardOptions,
} from '../src/dev/test-board-seed.ts';
import { patchSessionState, readWholeSessionState } from '../server/config/sessions-repo.js';

function printHelp(): void {
  console.log(`Usage: npm run seed:test-board -- [options]

Seed a pre-initialized orchestrate board into ~/.minnow sessions.

Options:
  --workspace <path>   Workspace root (default: cwd)
  --preset quick|smoke quick = 3 parallel W1 tasks; smoke = full board-smoke plan
  --mode manual|auto|sequential   Default: manual
  --provider <id>      Planner provider (default: fake-board)
  --model <id>         Planner model (default: fake-board-model)
  --auto-start         Set board.autoRunning (use with --mode auto)
  --stable-id          Reuse canonical test board ids (for CI / log fixtures)
  --help               Show this help

After seeding:
  1. npm run fake-model -- --register   (separate terminal)
  2. npm start / npm run desktop
  3. Open the workspace folder — chat "Test board (quick)" is ready on the board

Re-run to reset the same test board. Restart Minnow if it was open during seeding.
`);
}

function parseArgs(argv: string[]): SeedTestBoardOptions & { help?: boolean } {
  const out: SeedTestBoardOptions & { help?: boolean } = {
    workspacePath: process.cwd(),
    preset: 'quick',
    mode: 'manual',
    providerId: 'fake-board',
    modelId: 'fake-board-model',
    autoStart: false,
    stableIds: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--stable-id') {
      out.stableIds = true;
      continue;
    }
    if (arg === '--workspace') {
      const next = argv[++i];
      if (!next) throw new Error('--workspace requires a path');
      out.workspacePath = next;
      continue;
    }
    if (arg === '--preset') {
      const next = argv[++i];
      if (next !== 'quick' && next !== 'smoke') {
        throw new Error('--preset must be quick or smoke');
      }
      out.preset = next as PresetId;
      continue;
    }
    if (arg === '--mode') {
      const next = argv[++i];
      if (next !== 'manual' && next !== 'auto' && next !== 'sequential') {
        throw new Error('--mode must be manual, auto, or sequential');
      }
      out.mode = next;
      continue;
    }
    if (arg === '--provider') {
      out.providerId = argv[++i] ?? '';
      continue;
    }
    if (arg === '--model') {
      out.modelId = argv[++i] ?? '';
      continue;
    }
    if (arg === '--auto-start') {
      out.autoStart = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  installHeadlessLocalStorage();

  const { planner, group } = buildTestBoardSession(args);
  const workspaceKey = normalizeWorkspacePath(planner.workspacePath);
  const existing = readWholeSessionState();

  const lastByWorkspace = {
    ...(existing.lastActiveChatIdByWorkspace ?? {}),
    [workspaceKey]: planner.id,
  };

  const applied = patchSessionState({
    baseVersion: existing.version ?? 6,
    chats: [planner],
    groups: [group],
    scalars: {
      activeId: planner.id,
      activeBoardGroupId: group.id,
      lastActiveChatIdByWorkspace: lastByWorkspace,
    },
  });

  const board = group.orchestrateBoard!;
  console.log('Seeded test board:');
  console.log(`  workspace:  ${planner.workspacePath}`);
  console.log(`  group:      ${group.id}`);
  console.log(`  planner:    ${planner.id} (${planner.name})`);
  console.log(`  plan:       ${group.orchestratePlanPath}`);
  console.log(`  tasks:      ${board.tasks.length} (${args.preset} preset)`);
  console.log(`  mode:       ${board.executionMode}${board.autoRunning ? ' (auto-running)' : ''}`);
  console.log(`  model:      ${planner.providerId}/${planner.modelId}`);
  console.log(
    `  sessions:   upserted chats=${applied.applied.chats} groups=${applied.applied.groups}`,
  );
  console.log('');
  console.log('Open Minnow on this workspace, or restart if already running.');
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
