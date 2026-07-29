/**
 * Shared orchestrate test-board seed presets and session builder.
 * Used by the CLI (`scripts/seed-test-board.mts`) and the board-testing API.
 */

import path from 'node:path';
import { randomUUID } from '../lib/random-id.ts';
import { initBoard } from '../state/orchestrate-board-store.ts';
import type { BoardTask, Chat, ChatGroup } from '../types.ts';

import {
  TEST_BOARD_GROUP_ID,
  TEST_BOARD_PLANNER_ID,
} from '../../server/orchestrate/board-testing/constants.js';

export { TEST_BOARD_GROUP_ID, TEST_BOARD_PLANNER_ID };

const QUICK_PLAN = 'documentation/plans/test-board-quick.md';
const SMOKE_PLAN = 'documentation/plans/orchestrator-board-smoke.md';

export type PresetId = 'quick' | 'smoke';
export type ExecutionMode = 'manual' | 'auto' | 'sequential';

export type TestBoardSeedTask = {
  id: string;
  title: string;
  wave: string;
  category?: BoardTask['category'];
  build: string;
  test: string;
  dependsOn?: string[];
};

export type TestBoardPresetSpec = {
  planPath: string;
  label: string;
  tasks: TestBoardSeedTask[];
  waves: Array<{ id: string }>;
};

const PRESETS: Record<PresetId, TestBoardPresetSpec> = {
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

/** Return a detached preset graph for deterministic scenario validation. */
export function getTestBoardPreset(preset: PresetId): TestBoardPresetSpec {
  const spec = PRESETS[preset];
  return {
    planPath: spec.planPath,
    label: spec.label,
    tasks: spec.tasks.map((task) => ({
      ...task,
      ...(task.dependsOn ? { dependsOn: [...task.dependsOn] } : {}),
    })),
    waves: spec.waves.map((wave) => ({ ...wave })),
  };
}

export type SeedTestBoardOptions = {
  workspacePath: string;
  preset?: PresetId;
  mode?: ExecutionMode;
  providerId?: string;
  modelId?: string;
  autoStart?: boolean;
  /** When true, reuse canonical test ids (CI / log fixtures). Default: fresh ids per seed. */
  stableIds?: boolean;
};

function resolveSeedIds(options: SeedTestBoardOptions): { plannerId: string; groupId: string } {
  if (options.stableIds) {
    return { plannerId: TEST_BOARD_PLANNER_ID, groupId: TEST_BOARD_GROUP_ID };
  }
  const plannerId = randomUUID();
  return { plannerId, groupId: `grp_${plannerId}` };
}

/** Build planner + group with board_init already applied (no LLM). */
export function buildTestBoardSession(
  options: SeedTestBoardOptions,
): { planner: Chat; group: ChatGroup } {
  const preset = PRESETS[options.preset ?? 'quick'];
  const workspacePath = path.resolve(options.workspacePath);
  const providerId = options.providerId?.trim() || 'fake-board';
  const modelId = options.modelId?.trim() || 'fake-board-model';
  const mode = options.mode ?? 'manual';
  const { plannerId, groupId } = resolveSeedIds(options);
  const boardLabel =
    options.stableIds === true ? preset.label : `${preset.label} (${groupId.slice(-8)})`;

  const planner: Chat = {
    id: plannerId,
    name: boardLabel,
    workspacePath,
    modeId: 'orchestrate',
    providerId,
    modelId,
    history: [
      {
        role: 'assistant',
        content:
          'Test board seeded locally (board_init skipped). Open board view and press Start — pair with the fake board model provider for deterministic runs.',
      },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: Date.now(),
    orchestratePlanPath: preset.planPath,
    boardGroupId: groupId,
    viewMode: 'board',
  };

  const group: ChatGroup = {
    id: groupId,
    name: boardLabel,
    workspacePath,
    collapsed: false,
    order: 0,
    createdAt: Date.now(),
    plannerChatId: plannerId,
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
  board.integrationBranch = `minnow/integration/${groupId}`;

  return { planner, group };
}

/** Task count for the chosen preset (for API responses). */
export function taskCountForPreset(preset: PresetId = 'quick'): number {
  return PRESETS[preset].tasks.length;
}
