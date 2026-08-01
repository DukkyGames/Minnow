/**
 * Intent mode trigger plugin, keymap, and extension assembly (MIN-131).
 */

import { Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type KeyBinding } from '@codemirror/view';
import type { EditorIntentModeConfig } from '../../config/editor-intent-mode';
import { contextHashForRegion, resolvedContext, resolvedLineIndices } from './context';
import { parseRegionKey } from './controls';
import { intentRecheckPlugin, type IntentResolveDriver } from './recheck';
import { resolveIntentLine } from './resolver';
import {
  addIntentRegion,
  findIntentRegionAt,
  getIntentStaleCount,
  intentModeCompartmentExtension,
  intentModeConfigFacet,
  intentModeField,
  intentModeInitialEffect,
  intentSystemTransaction,
  isIntentModeEnabled,
  isLineResolved,
  removeIntentRegion,
  setIntentModeEnabled,
  setResolvingLine,
} from './state';
import type { IntentModeOptions, IntentRegion } from './types';

/** Toggle Intent mode for the active editor. */
export function toggleIntentMode(view: EditorView): boolean {
  const enabled = isIntentModeEnabled(view.state);
  view.dispatch({ effects: setIntentModeEnabled.of(!enabled) });
  return true;
}

/** Enable or disable Intent mode explicitly. */
export function setIntentMode(view: EditorView, enabled: boolean): void {
  if (isIntentModeEnabled(view.state) === enabled) return;
  view.dispatch({ effects: setIntentModeEnabled.of(enabled) });
}

/** Revert a resolved region back to its stored intent text. */
export function revertIntentRegion(view: EditorView, region: IntentRegion): void {
  view.dispatch({
    annotations: intentSystemTransaction.of(true),
    changes: { from: region.from, to: region.to, insert: region.intentText },
    effects: [
      removeIntentRegion.of({ from: region.from, to: region.to }),
      setResolvingLine.of(null),
    ],
  });
}

class IntentTriggerPlugin implements IntentResolveDriver {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private pendingLine: number | null = null;
  private lastLineNumber = 1;
  private readonly opts: IntentModeOptions;
  private readonly config: EditorIntentModeConfig;

  constructor(
    private readonly view: EditorView,
    opts: IntentModeOptions,
  ) {
    this.opts = opts;
    this.config = opts.config;
    this.lastLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
    this.bindControlEvents();
    this.notifyChrome(view.state);
  }

  update(update: import('@codemirror/view').ViewUpdate): void {
    if (!isIntentModeEnabled(update.state)) {
      this.cancelInFlight();
      this.notifyChrome(update.state);
      return;
    }

    const head = update.state.selection.main.head;
    const lineNumber = update.state.doc.lineAt(head).number;

    if (update.selectionSet && lineNumber !== this.lastLineNumber) {
      this.scheduleResolve(this.lastLineNumber);
      this.lastLineNumber = lineNumber;
    }

    if (update.docChanged) {
      const prevHead = update.startState.selection.main.head;
      const prevLine = update.startState.doc.lineAt(prevHead).number;
      if (prevLine !== lineNumber) {
        this.scheduleResolve(prevLine);
      }
      this.lastLineNumber = lineNumber;
    }

    if (
      update.state.field(intentModeField).regions !==
        update.startState.field(intentModeField).regions ||
      update.transactions.some((tr) => tr.effects.some((e) => e.is(setIntentModeEnabled)))
    ) {
      this.notifyChrome(update.state);
    }
  }

  destroy(): void {
    this.cancelInFlight();
    this.view.dom.removeEventListener('minnow-intent-revert', this.onRevert);
    this.view.dom.removeEventListener('minnow-intent-retry', this.onRetry);
    this.view.dom.removeEventListener('blur', this.onBlur, true);
    this.view.dom.removeEventListener('click', this.onClick);
  }

  isResolveInFlight(): boolean {
    return this.abortController !== null || this.pendingLine !== null;
  }

  resolveLine(lineNumber: number, intentOverride?: string): void {
    void this.runResolve(lineNumber, intentOverride);
  }

  private bindControlEvents(): void {
    this.view.dom.addEventListener('minnow-intent-revert', this.onRevert);
    this.view.dom.addEventListener('minnow-intent-retry', this.onRetry);
    this.view.dom.addEventListener('blur', this.onBlur, true);
    this.view.dom.addEventListener('click', this.onClick);
  }

  private readonly onRevert = (event: Event): void => {
    const detail = (event as CustomEvent<{ regionKey: string }>).detail;
    const parsed = parseRegionKey(detail.regionKey);
    if (!parsed) return;
    const row = this.view.state.field(intentModeField);
    const region = row.regions.find((r) => r.from === parsed.from && r.to === parsed.to);
    if (!region) return;
    revertIntentRegion(this.view, region);
  };

  private readonly onRetry = (event: Event): void => {
    const detail = (event as CustomEvent<{ regionKey: string }>).detail;
    const parsed = parseRegionKey(detail.regionKey);
    if (!parsed) return;
    const row = this.view.state.field(intentModeField);
    const region = row.regions.find((r) => r.from === parsed.from && r.to === parsed.to);
    if (!region) return;
    const line = this.view.state.doc.lineAt(region.from);
    void this.runResolve(line.number, region.intentText, region);
  };

  private readonly onBlur = (): void => {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = setTimeout(() => {
      this.blurTimer = null;
      if (!isIntentModeEnabled(this.view.state)) return;
      this.scheduleResolve(this.lastLineNumber);
    }, this.config.debounceMs);
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (!isIntentModeEnabled(this.view.state)) return;
    const target = event.target as HTMLElement;
    if (target.closest('.cm-intent-controls')) return;
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return;
    const region = findIntentRegionAt(this.view.state, pos);
    if (!region) return;
    revertIntentRegion(this.view, region);
  };

  private scheduleResolve(lineNumber: number): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runResolve(lineNumber);
    }, this.config.debounceMs);
  }

  private cancelInFlight(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.blurTimer) {
      clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.pendingLine = null;
    if (this.view.state.field(intentModeField).resolvingLine !== null) {
      this.view.dispatch({ effects: setResolvingLine.of(null) });
    }
  }

  private notifyChrome(state: import('@codemirror/state').EditorState): void {
    const enabled = isIntentModeEnabled(state);
    this.opts.onEnabledChange?.(enabled);
    this.opts.onStaleCount?.(getIntentStaleCount(state));
  }

  private async runResolve(
    lineNumber: number,
    intentOverride?: string,
    existingRegion?: IntentRegion,
  ): Promise<void> {
    const { state } = this.view;
    if (!isIntentModeEnabled(state)) return;
    if (state.readOnly) return;
    if (!this.opts.canRequest()) {
      this.opts.onStatus?.('Intent mode unavailable (open Minnow and configure a provider).');
      return;
    }
    if (lineNumber < 1 || lineNumber > state.doc.lines) return;
    if (!intentOverride && isLineResolved(state, lineNumber)) return;

    const line = state.doc.line(lineNumber);
    const intentText = (intentOverride ?? line.text).trim();
    if (!intentText) return;

    if (existingRegion) {
      this.view.dispatch({
        annotations: intentSystemTransaction.of(true),
        changes: { from: existingRegion.from, to: existingRegion.to, insert: intentText },
        effects: removeIntentRegion.of({
          from: existingRegion.from,
          to: existingRegion.to,
        }),
      });
    }

    this.cancelInFlight();
    const controller = new AbortController();
    this.abortController = controller;
    this.pendingLine = lineNumber;

    this.view.dispatch({ effects: setResolvingLine.of(lineNumber) });
    this.opts.onStatus?.('Resolving intent…');

    try {
      const docText = this.view.state.doc.toString();
      const regions = this.view.state.field(intentModeField).regions;
      const resolved = resolvedLineIndices(docText, regions);
      const lines = docText.split('\n');
      const { above, below } = resolvedContext(
        lines,
        lineNumber - 1,
        resolved,
        this.config.contextWindow,
      );

      const code = await resolveIntentLine({
        filePath: this.opts.filePath,
        intentText,
        above,
        below,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      if (!isIntentModeEnabled(this.view.state)) return;

      const freshLine = this.view.state.doc.line(lineNumber);
      if (!code) {
        this.opts.onStatus?.('Intent resolve failed — check provider and model in Settings');
        return;
      }

      const regionFrom = freshLine.from;
      const regionTo = freshLine.to;
      const previewDoc = applyReplacementPreview(
        this.view.state.doc.toString(),
        regionFrom,
        regionTo,
        code,
      );
      const draftRegion: IntentRegion = {
        from: regionFrom,
        to: regionFrom + code.length,
        intentText,
        ctxHash: '',
        stale: false,
      };
      const ctxHash = contextHashForRegion(
        previewDoc,
        [...regions, draftRegion],
        draftRegion,
        this.config.contextWindow,
      );

      this.view.dispatch({
        annotations: intentSystemTransaction.of(true),
        changes: { from: regionFrom, to: regionTo, insert: code },
        effects: [
          addIntentRegion.of({
            from: regionFrom,
            to: regionFrom + code.length,
            intentText,
            ctxHash,
            stale: false,
          }),
          setResolvingLine.of(null),
        ],
      });
      this.opts.onStatus?.(null);
      this.notifyChrome(this.view.state);
    } catch {
      this.opts.onStatus?.('Intent resolve failed — check provider and model in Settings');
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        this.pendingLine = null;
        if (this.view.state.field(intentModeField).resolvingLine === lineNumber) {
          this.view.dispatch({ effects: setResolvingLine.of(null) });
        }
      }
    }
  }
}

function applyReplacementPreview(doc: string, from: number, to: number, insert: string): string {
  return doc.slice(0, from) + insert + doc.slice(to);
}

function intentModeKeymap(opts: IntentModeOptions): KeyBinding[] {
  return [
    {
      key: 'Mod-i',
      run: (view) => {
        if (!opts.canRequest()) return false;
        const wasEnabled = isIntentModeEnabled(view.state);
        toggleIntentMode(view);
        opts.onEnabledChange?.(!wasEnabled);
        return true;
      },
    },
  ];
}

/** Assemble Intent mode extensions for the file editor. */
export function editorIntentModeExtensions(opts: IntentModeOptions): Extension[] {
  const config = opts.config;
  let triggerRef: IntentTriggerPlugin | null = null;

  const activeBundle: Extension[] = [
    ViewPlugin.define((view) => {
      triggerRef = new IntentTriggerPlugin(view, opts);
      return triggerRef;
    }),
    intentRecheckPlugin(config, {
      resolveLine: (line, intent) => triggerRef?.resolveLine(line, intent),
      isResolveInFlight: () => triggerRef?.isResolveInFlight() ?? false,
    }),
    Prec.high(keymap.of(intentModeKeymap(opts))),
  ];

  return [
    intentModeConfigFacet.of(config),
    intentModeField,
    intentModeCompartmentExtension(activeBundle),
  ];
}

/** Apply initial enabled flag after EditorView construction. */
export function mountIntentModeEditor(view: EditorView, enabled: boolean): void {
  view.dispatch({ effects: intentModeInitialEffect(enabled) });
}

export {
  getIntentStaleCount,
  isIntentModeEnabled,
  findIntentRegionOnLine,
} from './state';
