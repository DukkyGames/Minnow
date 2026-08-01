/**
 * Manual execution mode: confirm before Start / Start wave when deps or wave barriers are unmet.
 */

import type { BoardTask, ChatGroup } from '../types';
import {
  getBoardExecutionMode,
  getManualStartBlockers,
  type ManualStartBlocker,
} from '../state/orchestrate-board-store';
import { appConfirm } from './app-dialog';

function formatBoardTaskStatusLabel(status: string): string {
  switch (status) {
    case 'planned':
      return 'Planned';
    case 'blocked':
      return 'Blocked';
    case 'in_progress':
      return 'In progress';
    case 'testing':
      return 'Testing';
    case 'merging':
      return 'Merging';
    case 'complete':
      return 'Complete';
    case 'failed':
      return 'Failed';
    case 'quarantined':
      return 'Quarantined';
    default:
      return status;
  }
}

function formatDependsOnBlockerLine(blocker: Extract<ManualStartBlocker, { kind: 'dependsOn' }>): string {
  const title = blocker.title?.trim();
  const label = title ? `${blocker.taskId} — ${title}` : blocker.taskId;
  return `${label} (${formatBoardTaskStatusLabel(blocker.status)})`;
}

function formatPriorWaveBlockerLine(
  blocker: Extract<ManualStartBlocker, { kind: 'priorWave' }>,
): string {
  const ids = blocker.incompleteTaskIds.join(', ');
  return `Wave ${blocker.waveId}: ${ids} still running`;
}

function buildManualStartConfirmMessage(task: BoardTask, blockers: ManualStartBlocker[]): string {
  const title = task.title?.trim();
  const lead = title ? `Task ${task.id} — ${title}` : `Task ${task.id}`;
  const depLines = blockers
    .filter((b): b is Extract<ManualStartBlocker, { kind: 'dependsOn' }> => b.kind === 'dependsOn')
    .map((b) => `• ${formatDependsOnBlockerLine(b)}`);
  const waveLines = blockers
    .filter((b): b is Extract<ManualStartBlocker, { kind: 'priorWave' }> => b.kind === 'priorWave')
    .map((b) => `• ${formatPriorWaveBlockerLine(b)}`);

  const sections: string[] = [lead];
  if (depLines.length) {
    sections.push('', 'Dependencies not complete:', ...depLines);
  }
  if (waveLines.length) {
    sections.push('', 'Earlier waves not finished:', ...waveLines);
  }
  sections.push('', 'Start anyway?');
  return sections.join('\n');
}

function buildManualWaveStartConfirmMessage(
  summaries: Array<{ taskId: string; blockers: ManualStartBlocker[] }>,
): string {
  const lines = summaries.map(({ taskId, blockers }) => {
    const parts: string[] = [];
    for (const blocker of blockers) {
      if (blocker.kind === 'dependsOn') {
        parts.push(formatDependsOnBlockerLine(blocker));
      } else {
        parts.push(formatPriorWaveBlockerLine(blocker));
      }
    }
    return `• ${taskId}: ${parts.join('; ')}`;
  });
  return [
    'Some tasks in this wave are blocked by dependencies or earlier waves:',
    '',
    ...lines,
    '',
    'Start the wave anyway?',
  ].join('\n');
}

export async function confirmManualTaskStart(
  group: ChatGroup,
  task: BoardTask,
): Promise<boolean> {
  const board = group.orchestrateBoard;
  if (!board || getBoardExecutionMode(board) !== 'manual') return true;
  const blockers = getManualStartBlockers(board, task);
  if (!blockers.length) return true;
  return appConfirm(buildManualStartConfirmMessage(task, blockers), {
    title: 'Unmet dependencies',
    confirmLabel: 'Start anyway',
    cancelLabel: 'Cancel',
  });
}

export async function confirmManualWaveStart(
  group: ChatGroup,
  waveId: number | string,
): Promise<boolean> {
  const board = group.orchestrateBoard;
  if (!board || getBoardExecutionMode(board) !== 'manual') return true;
  const planned = board.tasks.filter(
    (t) => String(t.wave) === String(waveId) && t.status === 'planned',
  );
  const summaries: Array<{ taskId: string; blockers: ManualStartBlocker[] }> = [];
  for (const task of planned) {
    const blockers = getManualStartBlockers(board, task);
    if (blockers.length) summaries.push({ taskId: task.id, blockers });
  }
  if (!summaries.length) return true;
  return appConfirm(buildManualWaveStartConfirmMessage(summaries), {
    title: 'Unmet dependencies',
    confirmLabel: 'Start anyway',
    cancelLabel: 'Cancel',
  });
}
