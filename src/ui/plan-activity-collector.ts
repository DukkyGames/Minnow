/**
 * Super Plan activity collector — merges controller, main-turn, research SSE, and reviewer events.
 */

import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import { getMainTurnActivity, subscribeMainTurnActivity } from '../chat/main-turn-activity';
import { subscribeSuperPlanController } from '../chat/super-plan/controller';
import {
  SUPER_PLAN_STAGE_ORDER,
  type SuperPlanStageId,
  type SuperPlanState,
} from '../chat/super-plan/types';
import { findChatById } from '../state/sessions';
import type { Chat } from '../types';
import {
  ActivityLogBuffer,
  entryFromMainTurnActivity,
  entryFromSubAgentStatus,
  entryFromSuperPlanStage,
} from '../research/activity-log';
import {
  fetchResearchDetail,
  normalizeResearchActivityLog,
  subscribeToResearchStream,
} from '../research/client';
import type { ResearchProgress } from '../research/types';

export class PlanActivityCollector {
  private readonly chatId: string;
  private readonly buffer: ActivityLogBuffer;
  private unsubMainTurn: (() => void) | null = null;
  private unsubController: (() => void) | null = null;
  private unsubSubAgent: (() => void) | null = null;
  private unsubResearch: (() => void) | null = null;
  private lastStageKey = '';
  private lastMainTurnKey = '';
  private lastReviewerKey = '';
  private wiredResearchId: string | null = null;
  private lastPaused: boolean | null = null;

  constructor(chatId: string, buffer: ActivityLogBuffer) {
    this.chatId = chatId;
    this.buffer = buffer;
  }

  /**
   * Subscribe to live activity. Replays persisted stage + research rows first so
   * reload does not wipe the Activity ledger.
   */
  async start(): Promise<void> {
    this.stop();
    const chat = findChatById(this.chatId);
    if (chat?.superPlan) {
      let researchLog: ResearchProgress[] = [];
      const researchId = chat.superPlan.researchId?.trim();
      if (researchId) {
        try {
          const detail = await fetchResearchDetail(researchId);
          researchLog = normalizeResearchActivityLog(detail);
        } catch {
          /* run may not exist yet */
        }
      }
      this.replayPersistedActivity(chat.superPlan, researchLog);
      this.recordStage(chat.superPlan);
      if (chat.superPlan.paused) {
        this.buffer.append(entryFromSuperPlanStage(chat.superPlan.activeStage, 'paused'));
      }
      this.wireResearch(chat.superPlan.researchId);
    }

    this.unsubMainTurn = subscribeMainTurnActivity(() => {
      const row = getMainTurnActivity(this.chatId);
      if (!row) return;
      const key = `${row.phase}:${row.currentTool ?? ''}`;
      if (key === this.lastMainTurnKey) return;
      this.lastMainTurnKey = key;
      const entry = entryFromMainTurnActivity(row);
      if (entry) {
        this.buffer.append(entry);
      }
    });

    this.unsubController = subscribeSuperPlanController((updated) => {
      if (updated.id !== this.chatId || !updated.superPlan) return;
      this.recordStage(updated.superPlan);
      if (this.lastPaused !== updated.superPlan.paused) {
        this.lastPaused = updated.superPlan.paused ?? null;
        this.buffer.append(
          entryFromSuperPlanStage(
            updated.superPlan.activeStage,
            updated.superPlan.paused ? 'paused' : 'resumed',
          ),
        );
      }
      this.wireResearch(updated.superPlan.researchId);
    });

    this.unsubSubAgent = subscribeSubAgentRuns((run) => {
      const chat = findChatById(this.chatId);
      const reviewRunId = chat?.superPlan?.reviewRunId?.trim();
      if (!reviewRunId || run.runId !== reviewRunId) return;
      const tool = run.liveCurrentToolName?.trim() || null;
      const key = `${run.status}:${tool ?? ''}`;
      if (key === this.lastReviewerKey) return;
      this.lastReviewerKey = key;
      this.buffer.append(entryFromSubAgentStatus(run.status, tool));
    });
  }

  stop(): void {
    this.unsubMainTurn?.();
    this.unsubMainTurn = null;
    this.unsubController?.();
    this.unsubController = null;
    this.unsubSubAgent?.();
    this.unsubSubAgent = null;
    this.unsubResearch?.();
    this.unsubResearch = null;
    this.wiredResearchId = null;
    this.lastStageKey = '';
    this.lastMainTurnKey = '';
    this.lastReviewerKey = '';
    this.lastPaused = null;
  }

  /** Restore stage transitions and research SSE history from persisted chat + API. */
  private replayPersistedActivity(state: SuperPlanState, researchLog: ResearchProgress[]): void {
    for (const stageId of SUPER_PLAN_STAGE_ORDER) {
      const record = state.stages[stageId];
      if (!record || record.status === 'pending') {
        continue;
      }
      const status = record.status === 'blocked_user' ? 'waiting' : record.status;
      const atMs = record.finishedAt ?? record.startedAt ?? Date.now();
      this.buffer.append(entryFromSuperPlanStage(stageId, status, atMs));
    }
    for (const event of researchLog) {
      this.buffer.appendFromResearchProgress(event);
    }
    const active = state.activeStage;
    const activeRecord = state.stages[active];
    this.lastStageKey = `${active}:${activeRecord?.status ?? 'unknown'}`;
    this.lastPaused = Boolean(state.paused);
    const rid = state.researchId?.trim() ?? '';
    if (rid) {
      this.wiredResearchId = rid;
    }
  }

  private recordStage(state: SuperPlanState): void {
    const stageId = state.activeStage;
    const record = state.stages[stageId];
    const key = `${stageId}:${record?.status ?? 'unknown'}`;
    if (key === this.lastStageKey) return;
    this.lastStageKey = key;
    const status = record?.status === 'blocked_user' ? 'waiting' : (record?.status ?? 'running');
    this.buffer.append(entryFromSuperPlanStage(stageId, status));
  }

  private wireResearch(researchId: string | undefined): void {
    const id = researchId?.trim() ?? '';
    if (!id || this.wiredResearchId === id) return;
    this.unsubResearch?.();
    this.wiredResearchId = id;
    this.unsubResearch = subscribeToResearchStream(id, {
      onProgress: (event) => {
        this.buffer.appendFromResearchProgress(event);
      },
    });
  }
}

/** Resolve whether the chat is in a research stage for activity wiring. */
export function isSuperPlanResearchStage(chat: Chat | undefined): boolean {
  return chat?.superPlan?.activeStage === 'research';
}

/** Ordered stage list for tests. */
export function superPlanStageOrderForTests(): readonly SuperPlanStageId[] {
  return SUPER_PLAN_STAGE_ORDER;
}
