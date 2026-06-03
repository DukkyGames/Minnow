/**
 * Per-task Kanban card activity line (live tool phase, idle last action, sub-agent fallback).
 */

import {
  getMainTurnActivity,
  type MainTurnActivity,
} from '../main-turn-activity';
import { describeToolInvocation } from '../../tools/describe-invocation';
import { isChatStreaming } from '../streaming-state';
import type { BoardTask, Chat } from '../../types';
import {
  deriveOrchestratorLastActivity,
  type OrchestratorActivity,
} from './last-activity';

export type TaskCardActivityKind = OrchestratorActivity['kind'];

export interface TaskCardActivity {
  kind: TaskCardActivityKind;
  /** Short mono line on the card. */
  text: string;
  /** Full text for tooltip / aria. */
  title: string;
}

function truncateRunTask(text: string, max = 72): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function formatStreamingMainTurn(mainTurn: MainTurnActivity): TaskCardActivity {
  if (mainTurn.phase === 'tools' && mainTurn.currentTool) {
    const label = describeToolInvocation(mainTurn.currentTool, {}).title;
    const text = `Running ${label}…`;
    return {
      kind: 'tool',
      text,
      title: `Running tool: ${mainTurn.currentTool}`,
    };
  }
  if (mainTurn.phase === 'thinking') {
    return {
      kind: 'thinking',
      text: 'Thinking…',
      title: 'Model is reasoning',
    };
  }
  return {
    kind: 'waiting',
    text: 'Generating…',
    title: 'Waiting for model output',
  };
}

function formatIdleOrchestratorActivity(
  activity: OrchestratorActivity,
): TaskCardActivity {
  if (activity.kind === 'tool') {
    return {
      kind: 'tool',
      text: `Tool: ${activity.text}`,
      title: activity.title,
    };
  }
  return {
    kind: activity.kind,
    text: activity.text,
    title: activity.title,
  };
}

/** Active sub-agent run on the planner when the task has no dedicated chat yet. */
export interface TaskCardSubAgentHint {
  status: 'queued' | 'running';
  taskLabel: string;
}

function deriveSubAgentOnlyActivity(
  hint: TaskCardSubAgentHint | null | undefined,
): TaskCardActivity | null {
  if (!hint) return null;
  const rawTask = hint.taskLabel.trim();
  if (rawTask) {
    const short = truncateRunTask(rawTask);
    return {
      kind: 'waiting',
      text: short,
      title: rawTask,
    };
  }
  const label = hint.status === 'queued' ? 'Queued' : 'Running';
  return {
    kind: 'waiting',
    text: label,
    title: label,
  };
}

export interface DeriveTaskCardActivityInput {
  taskChat?: Chat | null;
  mainTurn?: MainTurnActivity;
  subAgentHint?: TaskCardSubAgentHint | null;
}

/** Activity line for a Kanban task card, or null when nothing to show. */
export function deriveTaskCardActivity(
  task: BoardTask,
  _plannerChat: Chat,
  input: DeriveTaskCardActivityInput = {},
): TaskCardActivity | null {
  const taskChatId = task.chatId?.trim();
  const taskChat = input.taskChat ?? null;
  const mainTurn =
    input.mainTurn ??
    (taskChatId ? getMainTurnActivity(taskChatId) : undefined);
  const streaming = Boolean(
    taskChat &&
      taskChatId &&
      (isChatStreaming(taskChatId) || mainTurn),
  );

  if (streaming && taskChat && taskChatId) {
    if (mainTurn) return formatStreamingMainTurn(mainTurn);
    return {
      kind: 'waiting',
      text: 'Generating…',
      title: 'Waiting for model output',
    };
  }

  if (taskChat) {
    const idle = deriveOrchestratorLastActivity(taskChat, false);
    if (idle) return formatIdleOrchestratorActivity(idle);
  }

  if (!taskChatId) {
    return deriveSubAgentOnlyActivity(input.subAgentHint);
  }

  return null;
}
