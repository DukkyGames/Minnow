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

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installHeadlessLocalStorage } from '../src/headless/server-context.ts';
import { normalizeWorkspacePath } from '../src/lib/normalize-workspace-path.ts';
import { initBoard } from '../src/state/orchestrate-board-store.ts';
import type { BoardTask, Chat, ChatGroup } from '../src/types.ts';
import { patchSessionState, readWholeSessionState } from '../server/config/sessions-repo.js';

export const TEST_BOARD_PLANNER_ID = 'a0000000-0000-4000-8000-000000000001';
export const TEST_BOARD_GROUP_ID = 'grp_a0000000-0000-4000-8000-000000000001';

const QUICK_PLAN = 'documentation/plans/test-board-quick.md';
const SMOKE_PLAN = 'documentation/plans/orchestrator-board-smoke.md';

type PresetId = 'quick' | 'smoke';
type ExecutionMode = 'manual' | 'auto' | 'sequential';

type SeedTask = {
  id: string;
  title: string;
  wave: string;
  category?: BoardTask['category'];
  build: string;
  test: string;
  dependsOn?: string[];
};

type PresetSpec = {
  planPath: string;
  label: string;
  tasks: SeedTask[];
  waves: Array<{ id: string }>;
};

const PRESETS: Record<PresetId, PresetSpec> = {
  quick: {
    planPath: QUICK_PLAN,
    label: 'Test board (quick)',
    waves: [{ id: 'W1' }],
    tasks: [
      {
        id: 'W1-A',
        title: 'Greet util',
        wave: 'W1',
        category: 'build',
        build: 'Create sandbox/test-board-quick/greet.ts',
        test: 'Read greet.ts; greet("World") → Hello, World!',
      },
      {
        id: 'W1-B',
        title: 'Add util',
        wave: 'W1',
        category: 'build',
        build: 'Create sandbox/test-board-quick/add.ts',
        test: 'Read add.ts; add(2, 3) → 5',
      },
      {
        id: 'W1-C',
        title: 'Index barrel',
        wave: 'W1',
        category: 'build',
        build: 'Create sandbox/test-board-quick/index.ts',
        test: 'Read index.ts; exports greet and add',
      },
    ],
  },
  smoke: {
    planPath: SMOKE_PLAN,
    label: 'Test board (smoke)',
    waves: [{ id: 'W1' }, { id: 'W2' }, { id: 'W3' }],
    tasks: [
      {
        id: 'W1-A',
        title: 'Create greet util',
        wave: 'W1',
        category: 'build',
        build: 'Create sandbox/board-smoke/greet.ts',
        test: 'Read greet.ts',
      },
      {
        id: 'W1-B',
        title: 'Create add util',
        wave: 'W1',
        category: 'build',
        build: 'Create sandbox/board-smoke/add.ts',
        test: 'Read add.ts',
      },
      {
        id: 'W1-C',
        title: 'Survey sandbox',
        wave: 'W1',
        category: 'research',
        build: 'List sandbox/board-smoke (read-only)',
        test: 'Report files present',
      },
      {
        id: 'W2-A',
        title: 'Wire index',
        wave: 'W2',
        category: 'build',
        dependsOn: ['W1-A', 'W1-B'],
        build: 'Create sandbox/board-smoke/index.ts',
        test: 'Read index.ts imports',
      },
      {
        id: 'W2-B',
        title: 'Unit test',
        wave: 'W2',
        category: 'test',
        dependsOn: ['W2-A'],
        build: 'Create sandbox/board-smoke/smoke.test.mts',
        test: 'Read smoke.test.mts',
      },
      {
        id: 'W3-A',
        title: 'Header comment',
        wave: 'W3',
        category: 'fix',
        dependsOn: ['W2-A'],
        build: 'Prepend header to index.ts',
        test: 'Confirm header line',
      },
    ],
  },
};

export type SeedTestBoardOptions = {
  workspacePath: string;
  preset?: PresetId;
  mode?: ExecutionMode;
  providerId?: string;
  modelId?: string;
  autoStart?: boolean;
};

/** Build planner + group with board_init already applied (no LLM). */
export function buildTestBoardSession(
  options: SeedTestBoardOptions,
): { planner: Chat; group: ChatGroup } {
  const preset = PRESETS[options.preset ?? 'quick'];
  const workspacePath = path.resolve(options.workspacePath);
  const providerId = options.providerId?.trim() || 'fake-board';
  const modelId = options.modelId?.trim() || 'fake-board-model';
  const mode = options.mode ?? 'manual';

  const planner: Chat = {
    id: TEST_BOARD_PLANNER_ID,
    name: preset.label,
    workspacePath,
    modeId: 'orchestrate',
    providerId,
    modelId,
    history: [
      {
        role: 'assistant',
        content:
          'Test board seeded locally (board_init skipped). Open board view and press Start — pair with `npm run fake-model -- --register` for deterministic runs.',
      },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: Date.now(),
    orchestratePlanPath: preset.planPath,
    boardGroupId: TEST_BOARD_GROUP_ID,
    viewMode: 'board',
  };

  const group: ChatGroup = {
    id: TEST_BOARD_GROUP_ID,
    name: preset.label,
    workspacePath,
    collapsed: false,
    order: 0,
    plannerChatId: TEST_BOARD_PLANNER_ID,
    orchestratePlanPath: preset.planPath,
    viewMode: 'board',
  };

  initBoard(group, planner, {
    planPath: preset.planPath,
    tasks: preset.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      wave: t.wave,
      category: t.category ?? 'build',
      build: t.build,
      test: t.test,
      ...(t.dependsOn?.length ? { dependsOn: [...t.dependsOn] } : {}),
    })),
    waves: preset.waves.map((w) => ({ id: w.id })),
  });

  const board = group.orchestrateBoard!;
  board.executionMode = mode;
  board.autoRunning = options.autoStart === true;
  board.integrationBranch = `minnow/integration/${TEST_BOARD_GROUP_ID}`;

  return { planner, group };
}

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
  --help               Show this help

After seeding:
  1. npm run fake-model -- --register   (separate terminal)
  2. npm start / npm run desktop
  3. Open the workspace folder — chat "${PRESETS.quick.label}" is ready on the board

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
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
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
      out.preset = next;
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
