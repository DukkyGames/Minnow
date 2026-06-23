/**
 * Super Plan staged controller — intake → spec → research → draft/review loops.
 */

import { cancelSubAgent, spawnSubAgent, waitForSubAgent } from '../agents/orchestrator';
import type { AggregateResult } from '../agents/types';
import { decodeModelSelectKey } from '../lib/model-select-key';
import { getActiveModelIdFromDom } from '../benchmark/resolve-binding';
import {
  cancelResearch,
  fetchResearchResult,
  startResearch,
  subscribeToResearchStream,
} from '../research/client';
import type { ResearchStreamEndEvent } from '../research/types';
import { findChatById, scheduleSaveSessions, touchChat } from '../state/sessions';
import { executeTool as defaultExecuteTool } from '../tools/client';
import {
  buildDraftTask,
  buildQuestionGenerationTask,
  buildReviewTask,
  buildSpecSynthesisTask,
} from './prompts/index';
import {
  foldUiGuidanceIntoPlan,
  resolveReviseTarget,
  type SuperPlanReviseTarget,
} from './helpers';
import {
  defaultSuperPlanPath,
  extractPlanPathFromSummary,
  formatAnswersBlock,
  parseQuestionnaireJson,
  planContainsCodeSnippets,
  superPlanStageToProgress,
} from './helpers';
import { inferPlanTitleFromMarkdown } from './plan-slug';
import { runImpeccableStage, writeFinalPlanFile } from './finalize-stage';
import type {
  SuperPlanProgress,
  SuperPlanQuestion,
  SuperPlanQuestionnaireAnswers,
  SuperPlanRunState,
} from './types';

export interface SuperPlanControllerOptions {
  onStateChange?: () => void;
  /** Desktop mounts the intake questionnaire when questions are ready. */
  onIntakeReady?: (questions: SuperPlanQuestion[]) => void;
  /** Called when impeccable + finalize complete with written plan. */
  onComplete?: (planPath: string, planMarkdown: string) => void;
}

type SpawnFn = typeof spawnSubAgent;
type WaitFn = typeof waitForSubAgent;
type StartResearchFn = typeof startResearch;
type SubscribeFn = typeof subscribeToResearchStream;
type ExecuteToolFn = typeof defaultExecuteTool;

interface SuperPlanControllerDeps {
  spawnSubAgent: SpawnFn;
  waitForSubAgent: WaitFn;
  startResearch: StartResearchFn;
  subscribeToResearchStream: SubscribeFn;
  cancelResearch: typeof cancelResearch;
  fetchResearchResult: typeof fetchResearchResult;
  cancelSubAgent: typeof cancelSubAgent;
  executeTool: ExecuteToolFn;
}

const defaultDeps: SuperPlanControllerDeps = {
  spawnSubAgent,
  waitForSubAgent,
  startResearch,
  subscribeToResearchStream,
  cancelResearch,
  fetchResearchResult,
  cancelSubAgent,
  executeTool: defaultExecuteTool,
};

let deps: SuperPlanControllerDeps = { ...defaultDeps };

/** Test hook: inject mocked orchestrator/research clients. */
export function setSuperPlanControllerDepsForTests(
  overrides: Partial<SuperPlanControllerDeps>,
): void {
  deps = { ...defaultDeps, ...overrides };
}

/** Restore production dependencies after tests. */
export function resetSuperPlanControllerDepsForTests(): void {
  deps = { ...defaultDeps };
}

function isAggregateResult(
  result: Awaited<ReturnType<SpawnFn>>,
): result is AggregateResult {
  return 'summary' in result;
}

/** Staged Super Plan pipeline with persisted chat state. */
export class SuperPlanController {
  private readonly chatId: string;
  private readonly onProgress: (event: SuperPlanProgress) => void;
  private readonly options: SuperPlanControllerOptions;
  private state: SuperPlanRunState | null = null;
  private pipelineGeneration = 0;
  private activeSubAgentRunId: string | null = null;
  private researchUnsubscribe: (() => void) | null = null;
  private researchAbort: AbortController | null = null;
  private specGateResolve: (() => void) | null = null;
  private specGateReject: ((reason?: unknown) => void) | null = null;
  private specGateGeneration = 0;

  constructor(
    chatId: string,
    onProgress: (event: SuperPlanProgress) => void,
    options: SuperPlanControllerOptions = {},
  ) {
    this.chatId = chatId;
    this.onProgress = onProgress;
    this.options = options;
  }

  /** Current persisted run state (read-only snapshot). */
  getRunState(): SuperPlanRunState | null {
    return this.state ? { ...this.state } : null;
  }

  /** Begin or resume the Super Plan pipeline for `userPrompt`. */
  async start(userPrompt: string): Promise<void> {
    const trimmed = userPrompt.trim();
    if (!trimmed) {
      this.fail('Enter a plan prompt');
      return;
    }

    const chat = findChatById(this.chatId);
    const existing = chat?.superPlan;
    if (
      existing &&
      existing.userPrompt.trim() === trimmed &&
      existing.status !== 'done' &&
      existing.status !== 'cancelled' &&
      existing.status !== 'error'
    ) {
      this.state = { ...existing };
      this.pipelineGeneration += 1;
      await this.resumePipeline(this.pipelineGeneration);
      return;
    }

    this.pipelineGeneration += 1;
    const generation = this.pipelineGeneration;
    this.state = {
      stage: 'intake',
      userPrompt: trimmed,
      status: 'running',
      startedAt: new Date().toISOString(),
      draftPaths: [],
      reviewNotes: [],
    };
    this.persist();

    try {
      await this.runIntake(generation);
    } catch (err) {
      if (generation !== this.pipelineGeneration) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.fail(message);
    }
  }

  /** Cancel the active stage and mark the run cancelled. */
  cancel(): void {
    this.pipelineGeneration += 1;
    if (this.activeSubAgentRunId) {
      deps.cancelSubAgent(this.activeSubAgentRunId);
      this.activeSubAgentRunId = null;
    }
    this.teardownResearchStream();
    this.invalidateSpecGate(new Error('cancelled'));
    if (this.state) {
      this.state.status = 'cancelled';
      this.state.stage = 'error';
      this.persist();
    }
    this.emit(superPlanStageToProgress('error', 'Super Plan cancelled'));
  }

  /** Continue after the user confirms the specification. */
  async confirmSpec(): Promise<void> {
    if (!this.state || this.state.stage !== 'spec' || this.state.status !== 'awaiting_user') {
      return;
    }
    this.state.status = 'running';
    this.persist();
    const resolve = this.specGateResolve;
    this.specGateResolve = null;
    this.specGateReject = null;
    resolve?.();
  }

  /** Request specification revision with user notes. */
  async reviseSpec(notes: string): Promise<void> {
    if (!this.state || this.state.stage !== 'spec') {
      return;
    }
    const trimmed = notes.trim();
    if (!trimmed) {
      return;
    }
    this.invalidateSpecGate(new Error('revised'));
    this.state.status = 'running';
    this.persist();
    const generation = this.pipelineGeneration;
    try {
      await this.runSpec(generation, trimmed);
    } catch (err) {
      if (generation !== this.pipelineGeneration) {
        return;
      }
      if (err instanceof Error && err.message === 'revised') {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.fail(message);
    }
  }

  /** Submit intake questionnaire answers and continue to spec synthesis. */
  async submitIntakeAnswers(answers: SuperPlanQuestionnaireAnswers): Promise<void> {
    if (!this.state) {
      return;
    }
    this.state.answers = answers;
    this.state.stage = 'spec';
    this.persist();
    const generation = this.pipelineGeneration;
    try {
      await this.runSpec(generation);
    } catch (err) {
      if (generation !== this.pipelineGeneration) {
        return;
      }
      if (err instanceof Error && err.message === 'revised') {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.fail(message);
    }
  }

  private async resumePipeline(generation: number): Promise<void> {
    if (!this.state) {
      return;
    }

    try {
      switch (this.state.stage) {
        case 'intake':
          if (this.state.questionnaire?.length && !this.state.answers) {
            this.emit(superPlanStageToProgress('intake', 'Complete the intake questionnaire'));
            this.options.onIntakeReady?.(this.state.questionnaire);
            return;
          }
          if (!this.state.questionnaire?.length) {
            await this.runIntake(generation);
            return;
          }
          await this.runSpec(generation);
          return;
        case 'spec':
          if (this.state.status === 'awaiting_user' && this.state.spec) {
            this.emit({
              stage: 'spec',
              message: 'Review the specification',
              preview: this.state.spec,
              awaitingUser: true,
            });
            await this.waitForSpecConfirmation(generation);
            if (generation !== this.pipelineGeneration || !this.state) {
              return;
            }
            await this.runResearch(generation);
            await this.runDraftReviewLoop(generation);
            return;
          }
          await this.runSpec(generation);
          return;
        case 'research':
          await this.runResearch(generation);
          await this.runDraftReviewLoop(generation);
          return;
        case 'draft1':
        case 'review1':
        case 'draft2':
        case 'review2':
          await this.runDraftReviewLoop(generation);
          return;
        case 'impeccable':
        case 'finalize':
          await this.runFinalizeStage(generation);
          return;
        default:
          return;
      }
    } catch (err) {
      if (generation !== this.pipelineGeneration) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.fail(message);
    }
  }

  private async runIntake(generation: number): Promise<void> {
    if (!this.state) {
      return;
    }
    this.state.stage = 'intake';
    this.state.status = 'running';
    this.persist();
    this.emit(superPlanStageToProgress('intake', 'Generating intake questions…'));

    const task = buildQuestionGenerationTask(this.state.userPrompt);
    const result = await this.spawnAndWait('generalPurpose', task, generation);
    if (!result || generation !== this.pipelineGeneration || !this.state) {
      return;
    }

    const questions = parseQuestionnaireJson(result.summary);
    if (!questions?.length) {
      this.fail('Could not parse intake questions from sub-agent');
      return;
    }

    this.state.questionnaire = questions;
    this.persist();
    this.emit(superPlanStageToProgress('intake', 'Answer the intake questionnaire'));
    this.options.onIntakeReady?.(questions);
  }

  private async runSpec(generation: number, revisionNotes = ''): Promise<void> {
    if (!this.state?.answers || !this.state.questionnaire?.length) {
      this.fail('Missing intake answers');
      return;
    }

    this.state.stage = 'spec';
    this.state.status = 'running';
    this.persist();
    this.emit(
      superPlanStageToProgress(
        'spec',
        revisionNotes ? 'Revising specification…' : 'Synthesizing build specification…',
      ),
    );

    const answersBlock = formatAnswersBlock(this.state.questionnaire, this.state.answers);
    const task = buildSpecSynthesisTask(
      this.state.userPrompt,
      answersBlock,
      revisionNotes,
    );
    const result = await this.spawnAndWait('plan-planner', task, generation);
    if (!result || generation !== this.pipelineGeneration || !this.state) {
      return;
    }

    const spec = result.summary.trim();
    if (!spec) {
      this.fail('Specification synthesis returned empty output');
      return;
    }

    this.state.spec = spec;
    this.state.status = 'awaiting_user';
    this.persist();
    this.emit({
      stage: 'spec',
      message: 'Review the specification',
      preview: spec,
      awaitingUser: true,
    });

    await this.waitForSpecConfirmation(generation);
    if (generation !== this.pipelineGeneration || !this.state) {
      return;
    }

    await this.runResearch(generation);
    if (generation !== this.pipelineGeneration || !this.state) {
      return;
    }
    await this.runDraftReviewLoop(generation);
  }

  private invalidateSpecGate(reason?: Error): void {
    this.specGateGeneration += 1;
    if (this.specGateReject) {
      this.specGateReject(reason ?? new Error('revised'));
    }
    this.specGateResolve = null;
    this.specGateReject = null;
  }

  private waitForSpecConfirmation(generation: number): Promise<void> {
    const gateGeneration = this.specGateGeneration;
    return new Promise((resolve, reject) => {
      if (generation !== this.pipelineGeneration) {
        reject(new Error('stale'));
        return;
      }
      this.specGateResolve = () => {
        if (gateGeneration !== this.specGateGeneration) {
          reject(new Error('revised'));
          return;
        }
        resolve();
      };
      this.specGateReject = (reason?: unknown) => {
        if (gateGeneration !== this.specGateGeneration) {
          reject(reason ?? new Error('revised'));
          return;
        }
        reject(reason ?? new Error('revised'));
      };
    });
  }

  private async runResearch(generation: number): Promise<void> {
    if (!this.state?.spec) {
      this.fail('Missing specification');
      return;
    }

    this.state.stage = 'research';
    this.state.status = 'running';
    this.persist();
    this.emit(superPlanStageToProgress('research', 'Starting deep research…'));

    const chat = findChatById(this.chatId);
    const binding = await this.resolveResearchBinding(chat?.providerId);
    const query = [
      'Research context for this build plan.',
      '',
      `User request: ${this.state.userPrompt}`,
      '',
      'Build specification:',
      this.state.spec,
    ].join('\n');

    const { researchId } = await deps.startResearch({
      query,
      maxRounds: 0,
      category: '',
      searchScope: 'both',
      workspaceRoot: chat?.workspacePath?.trim() || undefined,
      providerId: binding.providerId || undefined,
      model: binding.model || undefined,
    });

    this.state.researchId = researchId;
    this.persist();

    await new Promise<void>((resolve, reject) => {
      if (generation !== this.pipelineGeneration) {
        reject(new Error('stale'));
        return;
      }

      this.teardownResearchStream();
      this.researchAbort = new AbortController();

      this.researchUnsubscribe = deps.subscribeToResearchStream(researchId, {
        signal: this.researchAbort.signal,
        onProgress: (event) => {
          if (event.phase === 'searching' && event.round) {
            this.emit({
              stage: 'research',
              message: `Searching (round ${event.round})…`,
              round: event.round,
              researchId,
            });
            return;
          }
          if (event.phase === 'reading') {
            this.emit({
              stage: 'research',
              message: event.title ? `Reading: ${event.title}` : 'Reading sources…',
              researchId,
            });
            return;
          }
          if (event.phase === 'writing') {
            this.emit({
              stage: 'research',
              message: event.message ?? 'Writing research brief…',
              researchId,
            });
          }
        },
        onEnd: (endEvent?: ResearchStreamEndEvent) => {
          this.teardownResearchStream();
          const status = endEvent?.status ?? 'done';
          if (status === 'cancelled') {
            reject(new Error('cancelled'));
            return;
          }
          if (status === 'error') {
            reject(new Error(endEvent?.message ?? 'Research failed'));
            return;
          }
          resolve();
        },
        onTransportError: (err) => {
          this.teardownResearchStream();
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      });
    });

    if (generation !== this.pipelineGeneration || !this.state) {
      return;
    }

    this.emit(superPlanStageToProgress('research', 'Research complete'));
  }

  private async runDraftReviewLoop(generation: number): Promise<void> {
    if (!this.state?.spec) {
      return;
    }

    let researchBrief = '';
    if (this.state.researchId) {
      try {
        const data = await deps.fetchResearchResult(this.state.researchId);
        researchBrief = data.result?.trim() ?? '';
        this.state.researchMarkdown = researchBrief;
        this.persist();
      } catch {
        researchBrief = this.state.researchMarkdown ?? '';
      }
    }

    const reviewNotes = [...(this.state.reviewNotes ?? [])];
    const stage = this.state.stage;

    if (stage === 'review2') {
      const note2 = await this.runReview(generation, 2);
      if (generation !== this.pipelineGeneration || !this.state) {
        return;
      }
      if (note2) {
        reviewNotes[1] = note2;
        this.state.reviewNotes = reviewNotes;
        this.persist();
      }
      await this.runFinalizeStage(generation);
      return;
    }

    const needsDraft1 = stage === 'research' || stage === 'draft1';
    const needsReview1 = needsDraft1 || stage === 'review1';
    const needsDraft2 = needsReview1 || stage === 'draft2';

    if (needsDraft1) {
      await this.runDraft(generation, 1, researchBrief, '');
      if (generation !== this.pipelineGeneration || !this.state) {
        return;
      }
    }

    const afterDraft1 = this.state.stage;
    if (needsReview1 && afterDraft1 !== 'draft2') {
      const note1 = await this.runReview(generation, 1);
      if (generation !== this.pipelineGeneration || !this.state) {
        return;
      }
      if (note1) {
        reviewNotes[0] = note1;
        this.state.reviewNotes = reviewNotes;
        this.persist();
      }
    }

    if (needsDraft2) {
      await this.runDraft(generation, 2, researchBrief, reviewNotes[0] ?? '');
      if (generation !== this.pipelineGeneration || !this.state) {
        return;
      }
    }

    const note2 = await this.runReview(generation, 2);
    if (generation !== this.pipelineGeneration || !this.state) {
      return;
    }
    if (note2) {
      reviewNotes[1] = note2;
      this.state.reviewNotes = reviewNotes;
      this.persist();
    }

    await this.runFinalizeStage(generation);
  }

  /** Wave 4 — impeccable UI pass, write validated plan, notify desktop. */
  private async runFinalizeStage(generation: number): Promise<void> {
    if (!this.state?.spec || generation !== this.pipelineGeneration) {
      return;
    }

    const draftMarkdown = await this.resolveDraftMarkdown();
    if (!draftMarkdown.trim()) {
      this.fail('Missing draft plan content for finalize');
      return;
    }

    this.state.draftMarkdown = draftMarkdown;
    this.persist();

    const ctx = {
      chatId: this.chatId,
      userPrompt: this.state.userPrompt,
      state: this.state,
      draftMarkdown,
      emit: (event: SuperPlanProgress) => this.emit(event),
      getResultMount: () => document.getElementById('desktopSuperPlanResultBody'),
      onRevise: (target: SuperPlanReviseTarget, notes?: string) => {
        this.reviseFromFinish(target, notes);
      },
    };

    const guidance = await runImpeccableStage(ctx);
    if (generation !== this.pipelineGeneration || !this.state) {
      return;
    }

    const merged = foldUiGuidanceIntoPlan(draftMarkdown, guidance);
    const titleSeed = inferPlanTitleFromMarkdown(merged, this.state.userPrompt);

    this.state.stage = 'finalize';
    this.state.status = 'running';
    this.persist();
    this.emit({ stage: 'finalize', message: 'Writing final plan…' });

    const planPath = await writeFinalPlanFile(this.chatId, merged, titleSeed);
    if (generation !== this.pipelineGeneration || !this.state) {
      return;
    }

    this.state.finalPlanPath = planPath;
    this.state.finalPlanMarkdown = merged;
    this.state.stage = 'done';
    this.state.status = 'done';
    this.persist();

    this.emit({ stage: 'finalize', planPath, message: `Saved ${planPath}` });
    this.emit({ stage: 'done', planPath, message: 'Super Plan complete' });
    this.options.onComplete?.(planPath, merged);
    this.options.onStateChange?.();
  }

  private async resolveDraftMarkdown(): Promise<string> {
    if (!this.state) {
      return '';
    }
    if (this.state.draftMarkdown?.trim()) {
      return this.state.draftMarkdown.trim();
    }
    const path = this.state.draftPaths?.[1] ?? this.state.draftPaths?.[0] ?? this.state.finalPlanPath;
    if (!path?.trim()) {
      return '';
    }
    try {
      const result = await deps.executeTool('read_file', { path }, { chatId: this.chatId, modeId: 'plan' });
      return result.content.trim();
    } catch {
      return '';
    }
  }

  /** Re-enter at spec or draft after finish popout Revise. */
  reviseFromFinish(target: SuperPlanReviseTarget, notes?: string): void {
    if (!this.state) {
      return;
    }
    const generation = this.pipelineGeneration;
    if (notes?.trim()) {
      this.state.reviewNotes = [...(this.state.reviewNotes ?? []), notes.trim()];
    }

    if (target === 'spec') {
      this.state.stage = 'spec';
      this.state.status = 'awaiting_user';
      this.persist();
      this.emit({
        stage: 'spec',
        message: 'Revise the specification',
        preview: this.state.spec,
        awaitingUser: true,
      });
      return;
    }

    this.state.stage = 'draft2';
    this.state.status = 'running';
    this.persist();
    this.emit({ stage: 'draft2', message: 'Revising plan draft…' });
    void this.runDraftReviewLoop(generation).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.fail(message);
    });
  }

  /** Finish popout revise callback helper. */
  handleFinishRevise(notes?: string): void {
    this.reviseFromFinish(resolveReviseTarget(notes), notes);
  }

  private async runDraft(
    generation: number,
    pass: 1 | 2,
    researchBrief: string,
    priorReview: string,
  ): Promise<void> {
    if (!this.state?.spec) {
      return;
    }

    const stage = pass === 1 ? 'draft1' : 'draft2';
    this.state.stage = stage;
    this.state.status = 'running';
    this.persist();
    this.emit(superPlanStageToProgress(stage, `Writing draft ${pass}…`));

    const planPath =
      this.state.draftPaths?.[pass - 1] ??
      defaultSuperPlanPath(this.state.userPrompt, pass - 1);
    const task = buildDraftTask(this.state.spec, researchBrief, planPath, priorReview);
    const result = await this.spawnAndWait('plan-planner', task, generation);
    if (!result || generation !== this.pipelineGeneration || !this.state) {
      return;
    }

    if (planContainsCodeSnippets(result.summary)) {
      this.emit({
        stage,
        message: 'Warning: draft output may contain code snippets — planner should revise prose-only',
      });
    }

    const savedPath = extractPlanPathFromSummary(result.summary) ?? planPath;
    const paths = [...(this.state.draftPaths ?? [])];
    paths[pass - 1] = savedPath;
    this.state.draftPaths = paths;
    this.state.finalPlanPath = savedPath;
    this.state.draftMarkdown = result.summary.trim();
    this.persist();

    this.emit({
      stage,
      message: `Draft ${pass} saved`,
      planPath: savedPath,
      preview: result.summary.slice(0, 1200),
    });
  }

  private async runReview(generation: number, pass: 1 | 2): Promise<string> {
    if (!this.state?.spec) {
      return '';
    }

    const stage = pass === 1 ? 'review1' : 'review2';
    this.state.stage = stage;
    this.persist();
    this.emit(superPlanStageToProgress(stage, `Reviewing draft ${pass}…`, { round: pass }));

    const planPath = this.state.draftPaths?.[pass - 1];
    const planContent = planPath
      ? `Plan path: ${planPath}\n\n(See workspace file for full content.)`
      : '(Plan path unknown)';

    const task = buildReviewTask(this.state.spec, planContent);
    const result = await this.spawnAndWait('plan-reviewer', task, generation);
    if (!result || generation !== this.pipelineGeneration) {
      return '';
    }

    this.emit({
      stage,
      message: `Review ${pass} complete`,
      round: pass,
    });

    return result.summary.trim();
  }

  private async spawnAndWait(
    type: string,
    task: string,
    generation: number,
  ): Promise<AggregateResult | null> {
    if (generation !== this.pipelineGeneration) {
      return null;
    }

    const spawned = await deps.spawnSubAgent({
      type,
      task,
      wait: false,
      parentChatId: this.chatId,
      modeId: 'plan',
    });

    const runId = 'runId' in spawned ? spawned.runId : null;
    if (!runId) {
      this.fail(`Failed to spawn ${type} sub-agent`);
      return null;
    }

    this.activeSubAgentRunId = runId;
    const result = await deps.waitForSubAgent(runId);
    this.activeSubAgentRunId = null;

    if (generation !== this.pipelineGeneration) {
      return null;
    }

    if (!isAggregateResult(result)) {
      this.fail(`Sub-agent ${type} did not return a summary`);
      return null;
    }

    return result;
  }

  private async resolveResearchBinding(
    chatProviderId?: string,
  ): Promise<{ providerId: string; model: string }> {
    const raw = getActiveModelIdFromDom();
    const parsed = decodeModelSelectKey(raw);
    const model = parsed?.modelId ?? raw;
    const providerId = parsed?.providerId ?? chatProviderId?.trim() ?? '';
    return { providerId, model };
  }

  private teardownResearchStream(): void {
    this.researchUnsubscribe?.();
    this.researchUnsubscribe = null;
    this.researchAbort?.abort();
    this.researchAbort = null;
  }

  private persist(): void {
    const chat = findChatById(this.chatId);
    if (!chat || !this.state) {
      return;
    }
    chat.superPlan = { ...this.state };
    touchChat(chat);
    scheduleSaveSessions();
    this.options.onStateChange?.();
  }

  private emit(event: SuperPlanProgress): void {
    this.onProgress(event);
  }

  private fail(message: string): void {
    if (this.state) {
      this.state.status = 'error';
      this.state.stage = 'error';
      this.state.error = message;
      this.persist();
    }
    this.emit({ stage: 'error', message });
  }
}

export { planContainsCodeSnippets } from './helpers';
