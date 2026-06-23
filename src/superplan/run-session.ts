/**
 * Shared Super Plan UI session — progress panel, questionnaire, and controller wiring.
 */

import { SuperPlanController } from './controller';
import { mountSuperPlanFinishPopout } from './finish-popout';
import { mountSuperPlanQuestionnaire } from './questionnaire';
import { SuperPlanProgressPanel } from './progress-panel';
import type {
  SuperPlanProgress,
  SuperPlanQuestion,
  SuperPlanQuestionnaireAnswers,
  SuperPlanRunState,
} from './types';
import { getActiveChat } from '../state/sessions';
import { createChatWithMode } from '../ui/sidebar';
import { setStatus } from '../ui/status';

/** DOM ids for progress/result mounts and chrome controls. */
export interface SuperPlanMountIds {
  progressBodyId: string;
  resultBodyId: string;
  cancelBtnId?: string;
  closeBtnId?: string;
}

export interface SuperPlanSessionCallbacks {
  onRunActiveChange?: (active: boolean) => void;
  onDeactivate?: () => void;
}

export interface OpenSuperPlanOptions {
  /** When true, show idle UI and wait for a composer prompt instead of erroring. */
  allowIdleWithoutPrompt?: boolean;
}

/** Renderer-side Super Plan run scoped to one mount surface (desktop or Code). */
export class SuperPlanSession {
  private progressPanel: SuperPlanProgressPanel | null = null;
  private questionnaireMount: { destroy: () => void } | null = null;
  private finishMount: { destroy: () => void } | null = null;
  private controller: SuperPlanController | null = null;
  private running = false;
  private awaitingPrompt = false;
  private controlsBound = false;

  constructor(
    private readonly mounts: SuperPlanMountIds,
    private readonly callbacks: SuperPlanSessionCallbacks = {},
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  isAwaitingPrompt(): boolean {
    return this.awaitingPrompt;
  }

  isEngaged(): boolean {
    return this.running || this.awaitingPrompt;
  }

  getRunState(): SuperPlanRunState | null {
    return this.controller?.getRunState() ?? getActiveChat().superPlan ?? null;
  }

  applyProgress(event: SuperPlanProgress): void {
    this.progressPanel?.apply(event);
  }

  private getProgressMount(): HTMLElement | null {
    return document.getElementById(this.mounts.progressBodyId);
  }

  private getResultMount(): HTMLElement | null {
    return document.getElementById(this.mounts.resultBodyId);
  }

  private syncToolbar(): void {
    if (this.mounts.cancelBtnId) {
      const cancelBtn = document.getElementById(this.mounts.cancelBtnId);
      cancelBtn?.toggleAttribute('hidden', !this.running);
    }
  }

  private syncResultChrome(): void {
    if (this.mounts.closeBtnId) {
      const closeBtn = document.getElementById(this.mounts.closeBtnId);
      const body = this.getResultMount();
      const hasContent = Boolean(body?.childElementCount);
      closeBtn?.toggleAttribute('hidden', !hasContent);
    }
  }

  private clearProgressUi(): void {
    this.progressPanel?.destroy();
    this.progressPanel = null;
    this.questionnaireMount?.destroy();
    this.questionnaireMount = null;
    const progressMount = this.getProgressMount();
    if (progressMount) {
      progressMount.innerHTML = '';
    }
  }

  private resetRunUi(): void {
    this.clearProgressUi();
    this.finishMount?.destroy();
    this.finishMount = null;
    this.controller = null;
    const resultMount = this.getResultMount();
    if (resultMount) {
      resultMount.innerHTML = '';
    }
    this.syncToolbar();
    this.syncResultChrome();
  }

  private ensureProgressPanel(): SuperPlanProgressPanel | null {
    const mount = this.getProgressMount();
    if (!mount) {
      return null;
    }
    this.questionnaireMount?.destroy();
    this.questionnaireMount = null;
    if (!this.progressPanel) {
      this.progressPanel = new SuperPlanProgressPanel(mount, {
        onCancel: () => {
          void this.cancel();
        },
        onConfirmSpec: () => {
          void this.controller?.confirmSpec();
        },
        onReviseSpec: () => {
          const notes = window.prompt('What should change in the specification?');
          if (notes?.trim()) {
            void this.controller?.reviseSpec(notes.trim());
          }
        },
      });
      this.progressPanel.reset();
    }
    return this.progressPanel;
  }

  private mountIntakeQuestionnaire(questions: SuperPlanQuestion[]): void {
    const mount = this.getProgressMount();
    if (!mount) {
      return;
    }
    this.progressPanel?.destroy();
    this.progressPanel = null;
    this.questionnaireMount?.destroy();
    this.questionnaireMount = mountSuperPlanQuestionnaire(
      mount,
      questions,
      (answers) => {
        void this.onQuestionnaireSubmit(answers);
      },
      () => {
        void this.cancel();
      },
    );
  }

  private showFinishPopout(planPath: string, planMarkdown: string): void {
    const mount = this.getResultMount();
    if (!mount) {
      return;
    }
    this.clearProgressUi();
    this.finishMount?.destroy();
    this.finishMount = mountSuperPlanFinishPopout(mount, {
      planPath,
      planMarkdown,
      onRevise: (notes) => {
        this.finishMount?.destroy();
        this.finishMount = null;
        mount.innerHTML = '';
        this.syncResultChrome();
        this.ensureProgressPanel();
        this.controller?.handleFinishRevise(notes);
      },
      onStartOrchestrator: () => {
        createChatWithMode({
          modeId: 'orchestrate',
          orchestratePlanPath: planPath,
          initialUserMessage: `Run the orchestrator for plan ${planPath}.`,
        });
      },
      onSendToBuild: () => {
        const seed = [
          `Implement the plan at ${planPath}.`,
          '',
          'Plan excerpt:',
          planMarkdown.slice(0, 6000),
        ].join('\n');
        createChatWithMode({
          modeId: 'build',
          orchestratePlanPath: planPath,
          initialUserMessage: seed,
        });
      },
      onClose: () => {
        this.finishMount?.destroy();
        this.finishMount = null;
        mount.innerHTML = '';
        this.awaitingPrompt = false;
        this.callbacks.onRunActiveChange?.(false);
        this.callbacks.onDeactivate?.();
        this.syncResultChrome();
      },
    });
    this.syncResultChrome();
  }

  private onControllerProgress(event: SuperPlanProgress): void {
    if (event.stage === 'intake' && event.message?.includes('questionnaire')) {
      return;
    }
    this.ensureProgressPanel()?.apply(event);
    if (event.stage === 'error') {
      this.running = false;
      this.awaitingPrompt = false;
      this.syncToolbar();
      this.callbacks.onRunActiveChange?.(false);
      setStatus('err', event.message);
      return;
    }
    if (event.stage === 'done') {
      this.running = false;
      this.awaitingPrompt = false;
      this.syncToolbar();
      this.callbacks.onRunActiveChange?.(false);
      setStatus('ok', 'Super Plan complete');
    }
  }

  private async onQuestionnaireSubmit(
    answers: SuperPlanQuestionnaireAnswers,
  ): Promise<void> {
    this.ensureProgressPanel();
    this.progressPanel?.apply({ stage: 'intake', message: 'Intake complete' });
    await this.controller?.submitIntakeAnswers(answers);
  }

  private setRunActive(active: boolean): void {
    this.running = active;
    this.callbacks.onRunActiveChange?.(active);
    this.syncToolbar();
  }

  /** Start the controller pipeline with a user prompt. */
  async startRun(userPrompt: string): Promise<void> {
    const prompt = userPrompt.trim();
    if (!prompt) {
      setStatus('err', 'Enter a plan prompt');
      return;
    }

    if (this.running) {
      return;
    }

    this.awaitingPrompt = false;
    this.setRunActive(true);

    const resultMount = this.getResultMount();
    if (resultMount) {
      resultMount.innerHTML = '';
    }
    this.syncResultChrome();

    const chat = getActiveChat();
    this.controller = new SuperPlanController(chat.id, (event) => this.onControllerProgress(event), {
      onIntakeReady: (questions) => {
        this.mountIntakeQuestionnaire(questions);
      },
      onStateChange: () => {
        /* persisted on chat.superPlan */
      },
      onComplete: (planPath, planMarkdown) => {
        this.setRunActive(false);
        this.showFinishPopout(planPath, planMarkdown);
      },
    });

    this.clearProgressUi();
    this.ensureProgressPanel()?.apply({ stage: 'intake', message: 'Starting Super Plan…' });
    void this.controller.start(prompt);
  }

  /**
   * Open Super Plan — start immediately when a prompt is present, otherwise idle-wait
   * for composer input when allowIdleWithoutPrompt is set.
   */
  async open(prompt?: string, options?: OpenSuperPlanOptions): Promise<void> {
    if (this.running) {
      return;
    }

    const userPrompt = prompt?.trim() ?? '';
    if (!userPrompt) {
      if (options?.allowIdleWithoutPrompt) {
        this.awaitingPrompt = true;
        this.resetRunUi();
        return;
      }
      setStatus('err', 'Enter a plan prompt');
      return;
    }

    await this.startRun(userPrompt);
  }

  /** Consume a composer send while idle-waiting for the initial prompt. */
  trySubmitPrompt(text: string): boolean {
    if (!this.awaitingPrompt || this.running) {
      return false;
    }
    const prompt = text.trim();
    if (!prompt) {
      return false;
    }
    void this.startRun(prompt);
    return true;
  }

  /** Cancel the active Super Plan session. */
  async cancel(): Promise<void> {
    this.controller?.cancel();
    this.running = false;
    this.awaitingPrompt = false;
    this.progressPanel?.setStatus('cancelled', 'Super Plan cancelled');
    this.clearProgressUi();
    this.syncToolbar();
    this.callbacks.onRunActiveChange?.(false);
    this.callbacks.onDeactivate?.();
    setStatus('ok', 'Super Plan cancelled');
  }

  /** Tear down overlay content when leaving Super Plan mode. */
  teardown(): void {
    this.controller?.cancel();
    this.running = false;
    this.awaitingPrompt = false;
    this.resetRunUi();
    this.syncToolbar();
  }

  /** Wire cancel + close controls for this surface (idempotent). */
  wireControls(): void {
    if (this.controlsBound) {
      return;
    }
    this.controlsBound = true;

    if (this.mounts.cancelBtnId) {
      document.getElementById(this.mounts.cancelBtnId)?.addEventListener('click', () => {
        void this.cancel();
      });
    }
    if (this.mounts.closeBtnId) {
      document.getElementById(this.mounts.closeBtnId)?.addEventListener('click', () => {
        this.resetRunUi();
        this.awaitingPrompt = false;
        this.callbacks.onRunActiveChange?.(false);
        this.callbacks.onDeactivate?.();
      });
    }
  }
}
