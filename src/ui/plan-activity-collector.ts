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
import { findChatById, scheduleSaveSessions } from '../state/sessions';
import type { Chat } from '../types';
import {
  ActivityLogBuffer,
  activityLogContentKey,
  type ActivityLogEntry,
  entriesFromResearchProgress,
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

/**
 * Rows kept on `chat.superPlan.activityLog`, mirroring the `MAX_PERSISTED_MESSAGES`
 * capping idiom in sub-agent-session-sync: enough to reconstruct the ledger,
 * bounded so `state.json` cannot grow without limit.
 */
const MAX_PERSISTED_ACTIVITY = 200;

export class PlanActivityCollector {
  private readonly chatId: string;
  private readonly buffer: ActivityLogBuffer;
  private unsubBuffer: (() => void) | null = null;
  /** Suppresses persistence while seeding the buffer from what was persisted. */
  private replaying = false;
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

    // Mirror every subsequent append onto the chat so the ledger outlives both
    // leaving the screen and a reload (MIN-599).
    this.unsubBuffer = this.buffer.subscribe(() => this.persistBuffer());

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
      // Normalize undefined/false so stage advances do not look like a resume
      // (MIN-736). Only log when pause actually flips after we have a baseline.
      const paused = Boolean(updated.superPlan.paused);
      if (this.lastPaused === null) {
        this.lastPaused = paused;
      } else if (this.lastPaused !== paused) {
        this.lastPaused = paused;
        this.buffer.append(
          entryFromSuperPlanStage(
            updated.superPlan.activeStage,
            paused ? 'paused' : 'resumed',
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
    this.unsubBuffer?.();
    this.unsubBuffer = null;
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

  /** Write the live buffer back onto the chat, capped, for the next mount to replay. */
  private persistBuffer(): void {
    if (this.replaying) return;
    const chat = findChatById(this.chatId);
    if (!chat?.superPlan) return;

    const entries = this.buffer.getEntries();
    // A buffer reset must never erase the stored ledger — losing it is the bug.
    if (!entries.length && chat.superPlan.activityLog?.length) return;

    chat.superPlan.activityLog =
      entries.length <= MAX_PERSISTED_ACTIVITY
        ? [...entries]
        : entries.slice(-MAX_PERSISTED_ACTIVITY);
    // Dirty-hint rather than `touchChat`: an activity row is not a message, and
    // must not reorder the sidebar. The save itself is debounced.
    scheduleSaveSessions({ chatId: this.chatId });
  }

  /**
   * Seed the buffer from the persisted ledger, then top it up with stage
   * transitions and research SSE history.
   *
   * The persisted rows come first because they are the complete record — main
   * turns and reviewer status included. The two derived sources only ever added
   * stage and research rows, which is why the ledger used to come back nearly
   * empty; they now fill gaps rather than being the whole replay, and rows
   * already present are skipped by content (ids and timestamps are re-minted on
   * every derivation, so they cannot be compared).
   */
  private replayPersistedActivity(state: SuperPlanState, researchLog: ResearchProgress[]): void {
    const seen = new Set<string>();
    this.replaying = true;
    try {
      for (const entry of state.activityLog ?? []) {
        this.buffer.append(entry);
        seen.add(activityLogContentKey(entry));
      }

      const appendOnce = (entry: ActivityLogEntry): void => {
        const key = activityLogContentKey(entry);
        if (seen.has(key)) return;
        seen.add(key);
        this.buffer.append(entry);
      };

      for (const stageId of SUPER_PLAN_STAGE_ORDER) {
        const record = state.stages[stageId];
        if (!record || record.status === 'pending') {
          continue;
        }
        const status = record.status === 'blocked_user' ? 'waiting' : record.status;
        const atMs = record.finishedAt ?? record.startedAt ?? Date.now();
        appendOnce(entryFromSuperPlanStage(stageId, status, atMs));
      }
      for (const event of researchLog) {
        for (const row of entriesFromResearchProgress(event)) {
          appendOnce(row);
        }
      }
    } finally {
      this.replaying = false;
    }
    // Replay is history, not new activity — do not light up the unread badge.
    this.buffer.markRead();

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
