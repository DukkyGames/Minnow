import type { EditorState, Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { pickedCompletion } from '@codemirror/autocomplete';
import {
  getEditorAiCompletionConfigSync,
  type EditorAiCompletionConfig,
} from '../../config/editor-ai-completion';
import {
  getEditorIntentModeConfigSync,
  type EditorIntentModeConfig,
} from '../../config/editor-intent-mode';
import {
  fetchEditorAiCompletion,
  resolveEditorAiBinding,
  validateEditorAiBinding,
} from '../editor-ai-completion-client';
import {
  EditorRecentEditsRing,
  extractPrefixSuffix,
  shouldReplaceGhostPartial,
} from '../editor-ai-completion-prompt';
import {
  didLspCloseWithoutAccept,
  isLspBusy,
  shouldScheduleAi,
} from '../editor-completion-policy';
import { resolveLanguageDescription } from '../editor-language';
import {
  classifyIntentLine,
  intentInstructionFromLine,
  isIntentEligibleLanguage,
  leadingWhitespace,
  lineCommentForLanguage,
  type ClassifyIntentOptions,
} from './intent-heuristic';
import { resolveIntentSuggestion, type ResolveIntentInput } from './intent-prompt';
import {
  neighborLinesForPrompt,
} from './intent-context';
import { intentLineDecorationPlugin } from './intent-line-decorations';
import {
  mapPendingThroughTransactions,
  pendingToAnchor,
  type PendingIntentResolve,
} from './intent-pending';
import { acceptedIntentStalenessPlugin } from './intent-staleness';
import {
  acceptedIntentContextWindowFacet,
  acceptedIntentRegionsField,
} from './intent-regions';
import {
  getCompletionSuggestion,
  getIntentSuggestion,
  hasSuggestion,
  isIntentEnabled,
  setIntentEnabled,
  setSuggestion,
  createCompletionSuggestion,
  type IntentSuggestion,
} from './state';
import { recordCompletionEvent } from '../editor-ai-telemetry';

/** Shown once an intent proposal is painted. */
export const INTENT_READY_MESSAGE = 'Intent proposal ready — Tab to accept, Esc to dismiss';

/** Shown when the model echoes the intent line back unchanged. */
export const INTENT_NO_CHANGE_MESSAGE =
  'Model returned no change — rephrase the line or press Ctrl+Enter to retry.';

/** Generic intent failure. */
export const INTENT_FAILED_MESSAGE =
  'Intent resolve failed — check provider and model in Settings';

/** Re-dispatch a streaming partial only after this much new text. */
const PARTIAL_CHAR_THRESHOLD = 24;

export interface EditorSuggestionOptions {
  filePath: string;
  /** @deprecated Prefer getConfig — static config is not refreshed after Settings saves. */
  config?: EditorAiCompletionConfig;
  /** Live inline-completion settings (re-read on each request). */
  getConfig?: () => EditorAiCompletionConfig;
  /** Live Intent mode settings (re-read on each request). */
  getIntentConfig?: () => EditorIntentModeConfig;
  /** When false, no requests are made (npm start / provider offline). */
  canRequest: () => boolean;
  onStatus?: (message: string | null) => void;
  /** Fired when the user toggles Intent mode for this editor. */
  onIntentEnabledChange?: (enabled: boolean) => void;
  /** Fired when an intent request starts or finishes (spinner chrome). */
  onIntentBusyChange?: (busy: boolean) => void;
  /** Override the intent resolve (tests). */
  resolveIntentFn?: (input: ResolveIntentInput) => Promise<{ text: string | null; error?: string }>;
}

interface IntentAnchor {
  from: number;
  to: number;
  intentText: string;
}

/** Engine instances by view — the keymap needs the instance for Mod-Enter. */
const enginesByView = new WeakMap<EditorView, SuggestionEnginePlugin>();

export class SuggestionEnginePlugin {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private requestPos = -1;
  /** Epoch ms when an LSP completion item was last accepted (cooldown for AI). */
  private completionAcceptedAt = 0;
  private readonly recentEdits = new EditorRecentEditsRing();
  /** Prefix/suffix from the active completion request (monotonic partial validation). */
  private requestPrefix = '';
  private requestSuffix = '';
  /** Last streamed intent partial that was painted (flicker throttle). */
  private lastPartial = '';
  private intentBusy = false;
  private readonly languageName: string | null;
  /** 1-based line the cursor was on before the latest selection move. */
  private lastLineNumber = 1;
  private lineLeaveTimer: ReturnType<typeof setTimeout> | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;
  /** In-flight resolve anchor mapped through document edits while awaiting the model. */
  private pendingResolve: PendingIntentResolve | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly opts: EditorSuggestionOptions,
  ) {
    this.languageName = resolveLanguageDescription(opts.filePath)?.name ?? null;
    enginesByView.set(view, this);
    this.lastLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
    this.view.dom.addEventListener('blur', this.onBlur, true);
  }

  private onBlur = (): void => {
    if (!this.resolveIntentConfig().autoResolveOnLineLeave) return;
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = setTimeout(() => {
      this.blurTimer = null;
      if (!isIntentEnabled(this.view.state)) return;
      this.scheduleLineLeaveResolve(this.lastLineNumber);
    }, this.resolveIntentConfig().debounceMs);
  };

  destroy(): void {
    this.cancelInFlight(false);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.lineLeaveTimer) clearTimeout(this.lineLeaveTimer);
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.view.dom.removeEventListener('blur', this.onBlur, true);
    enginesByView.delete(this.view);
  }

  update(update: ViewUpdate): void {
    const { state } = update;

    if (isLspBusy(state)) {
      this.cancelInFlight(false, update.transactions[0]);
      return;
    }

    for (const tr of update.transactions) {
      if (tr.annotation(pickedCompletion) != null) {
        this.completionAcceptedAt = Date.now();
      }
      if (tr.docChanged) {
        this.recentEdits.recordTransaction(tr);
      }
    }

    if (this.pendingResolve && (update.docChanged || update.selectionSet)) {
      const mapped = mapPendingThroughTransactions(this.pendingResolve, update.transactions);
      if (!mapped) {
        this.pendingResolve = null;
        if (this.abortController) this.abortController.abort();
      } else {
        this.pendingResolve = mapped;
      }
    }

    if (update.selectionSet && !update.docChanged) {
      const ghostSurvived = getCompletionSuggestion(state) !== null;
      this.cancelInFlight(!ghostSurvived);
    }

    const intentToggled = update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(setIntentEnabled)),
    );
    if (intentToggled) {
      const enabled = isIntentEnabled(state);
      this.opts.onIntentEnabledChange?.(enabled);
      if (!enabled) this.cancelInFlight(true);
    }

    const lspClosedWithoutAccept = didLspCloseWithoutAccept(
      update.startState,
      state,
      update.transactions,
    );

    if (
      !update.docChanged &&
      !update.selectionSet &&
      !lspClosedWithoutAccept &&
      !intentToggled
    ) {
      return;
    }

    if (update.docChanged) {
      const ghostSurvived = getCompletionSuggestion(state) !== null;
      this.cancelInFlight(!ghostSurvived);
    }

    if (state.readOnly) return;
    if (!this.opts.canRequest()) {
      this.opts.onStatus?.('AI completion unavailable (open Minnow and configure a provider).');
      return;
    }
    this.opts.onStatus?.(null);

    this.trackIntentLineLeave(update);

    if (this.wantsIntent(state)) {
      this.scheduleIntent(this.anchorAtCursor(state), false);
      return;
    }

    const config = this.resolveConfig();
    if (!config.enabled) return;
    if (
      !shouldScheduleAi(
        {
          docChanged: update.docChanged,
          selectionSet: update.selectionSet,
          readOnly: state.readOnly,
          state,
          transactions: update.transactions,
          lspClosedWithoutAccept,
        },
        {
          isComposing: this.view.composing,
          completionAcceptedAt: this.completionAcceptedAt,
        },
      )
    ) {
      return;
    }

    this.scheduleCompletion(state.selection.main.head);
  }

  /** Track the line the cursor sits on and, when `autoResolveOnLineLeave` is set, queue a resolve for the line it just left. */
  private trackIntentLineLeave(update: ViewUpdate): void {
    const { state } = update;
    if (!isIntentEnabled(state)) return;
    const lineNumber = state.doc.lineAt(state.selection.main.head).number;
    const autoResolve = this.resolveIntentConfig().autoResolveOnLineLeave;

    if (update.docChanged) {
      const prevHead = update.startState.selection.main.head;
      const prevLine = update.startState.doc.lineAt(prevHead).number;
      if (autoResolve && prevLine !== lineNumber) {
        this.scheduleLineLeaveResolve(prevLine);
      }
      this.lastLineNumber = lineNumber;
      return;
    }

    if (update.selectionSet && lineNumber !== this.lastLineNumber) {
      if (autoResolve) this.scheduleLineLeaveResolve(this.lastLineNumber);
      this.lastLineNumber = lineNumber;
    }
  }

  /** Mod-Enter: resolve the current line as intent regardless of the heuristic. */
  force(): boolean {
    const state = this.view.state;
    if (state.readOnly) return false;
    if (!this.opts.canRequest()) {
      this.opts.onStatus?.('Intent mode unavailable (open Minnow and configure a provider).');
      return false;
    }
    const anchor = this.anchorAtCursor(state);
    if (!anchor.intentText.trim()) return false;
    this.scheduleIntent(anchor, true);
    return true;
  }

  private resolveConfig(): EditorAiCompletionConfig {
    return this.opts.getConfig?.() ?? this.opts.config ?? getEditorAiCompletionConfigSync();
  }

  private resolveIntentConfig(): EditorIntentModeConfig {
    return this.opts.getIntentConfig?.() ?? getEditorIntentModeConfigSync();
  }

  private classifyOptions(): ClassifyIntentOptions {
    return {
      sigil: this.resolveIntentConfig().sigil,
      lineComment: lineCommentForLanguage(this.languageName) ?? undefined,
    };
  }

  private anchorAtCursor(state: EditorState): IntentAnchor {
    const line = state.doc.lineAt(state.selection.main.head);
    return { from: line.from, to: line.to, intentText: line.text };
  }

  /** Auto-trigger gate: Intent on, single cursor, real language, prose line. */
  private wantsIntent(state: EditorState): boolean {
    if (!isIntentEnabled(state)) return false;
    if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
    if (!isIntentEligibleLanguage(this.languageName)) return false;
    const line = state.doc.lineAt(state.selection.main.head);
    return classifyIntentLine(line.text, this.classifyOptions()) === 'intent';
  }

  private scheduleCompletion(pos: number): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const delay = this.resolveConfig().debounceMs;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.requestCompletion(pos);
    }, delay);
  }

  private scheduleIntent(anchor: IntentAnchor, force: boolean): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const delay = force ? 0 : this.resolveIntentConfig().debounceMs;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.requestIntent(anchor, force);
    }, delay);
  }

  private scheduleLineLeaveResolve(lineNumber: number): void {
    if (this.lineLeaveTimer) clearTimeout(this.lineLeaveTimer);
    const delay = this.resolveIntentConfig().debounceMs;
    this.lineLeaveTimer = setTimeout(() => {
      this.lineLeaveTimer = null;
      const state = this.view.state;
      if (!isIntentEnabled(state)) return;
      if (lineNumber < 1 || lineNumber > state.doc.lines) return;
      const line = state.doc.line(lineNumber);
      const anchor: IntentAnchor = { from: line.from, to: line.to, intentText: line.text };
      if (!anchor.intentText.trim()) return;
      if (classifyIntentLine(line.text, this.classifyOptions()) !== 'intent') return;
      void this.requestIntent(anchor, false, false);
    }, delay);
  }

  /** Abort in-flight work; optionally clear the visible suggestion. */
  private cancelInFlight(clear: boolean, tr?: Transaction): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.lineLeaveTimer) {
      clearTimeout(this.lineLeaveTimer);
      this.lineLeaveTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.pendingResolve = null;
    this.setIntentBusy(false);
    const explicitSet = tr?.effects.some((effect) => effect.is(setSuggestion)) ?? false;
    if (clear && !explicitSet && hasSuggestion(this.view.state)) {
      const view = this.view;
      queueMicrotask(() => {
        if (hasSuggestion(view.state)) {
          view.dispatch({ effects: setSuggestion.of(null) });
        }
      });
    }
  }

  private setIntentBusy(busy: boolean): void {
    if (this.intentBusy === busy) return;
    this.intentBusy = busy;
    this.opts.onIntentBusyChange?.(busy);
  }

  private anchorStillValid(anchor: IntentAnchor): boolean {
    const doc = this.view.state.doc;
    if (anchor.to > doc.length) return false;
    return doc.sliceString(anchor.from, anchor.to) === anchor.intentText;
  }

  private cursorInsideAnchor(anchor: IntentAnchor): boolean {
    const head = this.view.state.selection.main.head;
    return head >= anchor.from && head <= anchor.to;
  }

  /** Paint an intent proposal after re-checking every guard. */
  private showIntent(
    anchor: IntentAnchor,
    text: string,
    streaming: boolean,
    requireCursorInside = true,
  ): boolean {
    if (isLspBusy(this.view.state)) return false;
    if (!this.anchorStillValid(anchor)) return false;
    if (requireCursorInside && !this.cursorInsideAnchor(anchor)) return false;

    const cleaned = text.replace(/\s+$/, '');
    if (!cleaned.trim()) return false;
    if (cleaned.trim() === anchor.intentText.trim()) {
      if (!streaming) this.opts.onStatus?.(INTENT_NO_CHANGE_MESSAGE);
      return false;
    }

    const proposal: IntentSuggestion = {
      kind: 'intent',
      from: anchor.from,
      to: anchor.to,
      intentText: anchor.intentText,
      text: cleaned,
      streaming,
    };
    this.view.dispatch({ effects: setSuggestion.of(proposal) });
    return true;
  }

  /** Throttle streaming repaints to whole lines or sizeable growth. */
  private shouldPaintPartial(text: string): boolean {
    if (!text) return false;
    const previous = this.lastPartial;
    if (!previous) {
      this.lastPartial = text;
      return true;
    }
    const gainedLine =
      text.split('\n').length > previous.split('\n').length;
    const grewEnough = text.length - previous.length > PARTIAL_CHAR_THRESHOLD;
    if (!gainedLine && !grewEnough) return false;
    this.lastPartial = text;
    return true;
  }

  private async requestIntent(
    anchor: IntentAnchor,
    force: boolean,
    requireCursorInside = true,
  ): Promise<void> {
    const state = this.view.state;
    if (state.readOnly) return;
    if (!force && !isIntentEnabled(state)) return;
    if (!this.opts.canRequest()) return;
    if (!this.anchorStillValid(anchor)) return;
    if (requireCursorInside && !this.cursorInsideAnchor(anchor)) return;
    if (!anchor.intentText.trim()) return;

    const existing = getIntentSuggestion(state);
    if (
      !force &&
      existing &&
      existing.from === anchor.from &&
      existing.to === anchor.to &&
      existing.intentText === anchor.intentText &&
      !existing.streaming
    ) {
      return;
    }

    this.cancelInFlight(false);
    const controller = new AbortController();
    this.abortController = controller;
    this.lastPartial = '';
    this.pendingResolve = {
      from: anchor.from,
      to: anchor.to,
      intentText: anchor.intentText,
    };
    this.setIntentBusy(true);

    const config = this.resolveConfig();
    const intentConfig = this.resolveIntentConfig();
    const classify = this.classifyOptions();
    const lineNumber = state.doc.lineAt(anchor.from).number;
    const { above, below } = neighborLinesForPrompt(
      state.doc,
      lineNumber,
      intentConfig.contextWindow,
    );
    const { prefix } = extractPrefixSuffix(state.doc, anchor.from, config);
    const { suffix } = extractPrefixSuffix(state.doc, anchor.to, config);
    const resolveFn = this.opts.resolveIntentFn ?? resolveIntentSuggestion;

    try {
      const result = await resolveFn({
        filePath: this.opts.filePath,
        intentText: anchor.intentText,
        instruction: intentInstructionFromLine(anchor.intentText, classify),
        prefix,
        suffix,
        above,
        below,
        baseIndent: leadingWhitespace(anchor.intentText),
        recentEdits: this.recentEdits.snapshot(),
        config,
        intentConfig,
        signal: controller.signal,
        onPartial: (partial) => {
          if (controller.signal.aborted) return;
          const pending = this.pendingResolve;
          if (!pending) return;
          const liveAnchor = pendingToAnchor(pending);
          if (!this.shouldPaintPartial(partial)) return;
          this.showIntent(liveAnchor, partial, true, requireCursorInside);
        },
      });

      if (controller.signal.aborted) return;
      const pending = this.pendingResolve;
      this.pendingResolve = null;
      if (!pending) return;
      const liveAnchor = pendingToAnchor(pending);
      if (!result.text) {
        if (result.error) this.opts.onStatus?.(result.error);
        return;
      }
      if (this.showIntent(liveAnchor, result.text, false, requireCursorInside)) {
        this.opts.onStatus?.(INTENT_READY_MESSAGE);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const message =
        err instanceof Error && err.message.trim() ? err.message : INTENT_FAILED_MESSAGE;
      this.opts.onStatus?.(message);
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        this.pendingResolve = null;
        this.setIntentBusy(false);
      }
    }
  }

  private async requestCompletion(pos: number): Promise<void> {
    const { state } = this.view;
    const config = this.resolveConfig();
    if (!config.enabled) return;
    if (state.readOnly) return;
    if (isLspBusy(state)) return;
    if (state.selection.main.head !== pos) return;

    const controller = new AbortController();
    this.abortController = controller;
    this.requestPos = pos;

    try {
      const binding = await resolveEditorAiBinding(config);
      const validation = validateEditorAiBinding(binding);
      if (validation.ok === false) {
        this.opts.onStatus?.(validation.message);
        return;
      }

      const { prefix, suffix } = extractPrefixSuffix(state.doc, pos, config);
      this.requestPrefix = prefix;
      this.requestSuffix = suffix;

      const result = await fetchEditorAiCompletion({
        state,
        cursorPos: pos,
        filePath: this.opts.filePath,
        config,
        binding,
        signal: controller.signal,
        recentEdits: this.recentEdits.snapshot(),
        onPartial: (partial, options) => {
          if (controller.signal.aborted) return;
          if (this.requestPos !== pos) return;
          const liveGhost = getCompletionSuggestion(this.view.state);
          if (liveGhost?.consumed) {
            if (!partial.startsWith(liveGhost.consumed)) {
              controller.abort();
              this.view.dispatch({ effects: setSuggestion.of(null) });
              return;
            }
          }
          this.paintCompletion(pos, partial, options?.fromCache ? 'cache' : 'stream');
        },
      });

      if (controller.signal.aborted) return;
      if (this.view.state.selection.main.head !== pos) return;
      if (this.requestPos !== pos) return;

      if (result.text) {
        this.paintCompletion(pos, result.text, 'stream');
        this.opts.onStatus?.('AI suggestion ready — Tab to accept, Esc to dismiss');
      } else if (!controller.signal.aborted && result.error) {
        this.opts.onStatus?.(result.error);
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : 'AI completion failed — check provider and model in Settings';
      this.opts.onStatus?.(message);
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  private paintCompletion(
    pos: number,
    text: string,
    origin: 'stream' | 'cache',
  ): void {
    if (!text) {
      if (hasSuggestion(this.view.state)) {
        this.view.dispatch({ effects: setSuggestion.of(null) });
      }
      return;
    }

    const current = getCompletionSuggestion(this.view.state);
    const anchorPos = current?.pos ?? pos;
    if (this.view.state.selection.main.head !== anchorPos) return;

    const consumedPrefix = current?.consumed ?? '';
    if (consumedPrefix && !text.startsWith(consumedPrefix)) {
      this.view.dispatch({ effects: setSuggestion.of(null) });
      return;
    }
    const remainder = consumedPrefix ? text.slice(consumedPrefix.length) : text;
    if (!remainder) {
      if (hasSuggestion(this.view.state)) {
        this.view.dispatch({ effects: setSuggestion.of(null) });
      }
      return;
    }

    const currentText = current?.text ?? '';
    if (
      currentText &&
      !shouldReplaceGhostPartial(currentText, text, this.requestPrefix, this.requestSuffix)
    ) {
      return;
    }

    const next = createCompletionSuggestion(remainder, anchorPos, origin, current);
    if (!current || current.id !== next.id) {
      recordCompletionEvent({ type: 'shown' });
    }

    this.view.dispatch({
      effects: setSuggestion.of(next),
    });
  }
}

/** Force an intent resolve on the current line (Mod-Enter). */
export function forceIntentResolve(view: EditorView): boolean {
  return enginesByView.get(view)?.force() ?? false;
}

/** Test seam: the live engine for a view, when mounted. */
export function getSuggestionEngine(view: EditorView): SuggestionEnginePlugin | undefined {
  return enginesByView.get(view);
}
