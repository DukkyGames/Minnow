/**
 * Auto-recheck cascade for stale Intent regions (MIN-131).
 */

import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { EditorIntentModeConfig } from '../../config/editor-intent-mode';
import type { IntentModeOptions } from './types';
import {
  findIntentRegionOnLine,
  intentModeField,
  isIntentModeEnabled,
} from './state';

export interface IntentResolveDriver {
  resolveLine: (lineNumber: number, intentOverride?: string) => void;
  isResolveInFlight: () => boolean;
}

/** Schedule re-resolves for stale regions when auto-recheck is enabled. */
export class IntentRecheckPlugin {
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;
  private passesRemaining = 0;
  private keystrokeBurst = false;

  constructor(
    private readonly view: EditorView,
    private readonly config: EditorIntentModeConfig,
    private readonly driver: IntentResolveDriver,
  ) {}

  update(update: ViewUpdate): void {
    if (!isIntentModeEnabled(update.state)) return;
    if (!this.config.autoRecheckDefault) return;

    if (update.docChanged && update.transactions.some((tr) => tr.isUserEvent('input'))) {
      this.keystrokeBurst = true;
      this.passesRemaining = this.config.maxRecheckPasses;
      this.clearTimer();
    }

    const prev = update.startState.field(intentModeField);
    const next = update.state.field(intentModeField);
    const staleCount = next.regions.filter((r) => r.stale).length;
    const prevStale = prev.regions.filter((r) => r.stale).length;

    if (staleCount === 0) {
      this.clearTimer();
      return;
    }

    if (staleCount !== prevStale || (staleCount > 0 && !this.recheckTimer)) {
      this.scheduleRecheck();
    }
  }

  destroy(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.recheckTimer) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }
  }

  private scheduleRecheck(): void {
    this.clearTimer();
    if (this.passesRemaining <= 0 && this.keystrokeBurst) return;
    if (this.driver.isResolveInFlight()) return;

    this.recheckTimer = setTimeout(() => {
      this.recheckTimer = null;
      void this.runRecheckPass();
    }, this.config.recheckDelayMs);
  }

  private runRecheckPass(): void {
    const { state } = this.view;
    if (!isIntentModeEnabled(state)) return;
    if (this.driver.isResolveInFlight()) return;

    const row = state.field(intentModeField);
    const stale = row.regions.find((r) => r.stale);
    if (!stale) return;

    if (this.keystrokeBurst) {
      if (this.passesRemaining <= 0) return;
      this.passesRemaining -= 1;
      if (this.passesRemaining <= 0) this.keystrokeBurst = false;
    }

    const line = state.doc.lineAt(stale.from);
    this.driver.resolveLine(line.number, stale.intentText);
  }
}

/** ViewPlugin factory for auto-recheck. */
export function intentRecheckPlugin(
  config: EditorIntentModeConfig,
  driver: IntentResolveDriver,
): ViewPlugin<IntentRecheckPlugin> {
  return ViewPlugin.define((view) => new IntentRecheckPlugin(view, config, driver));
}

/** Find stale region on a line for manual re-resolve. */
export function staleRegionOnLine(
  view: EditorView,
  lineNumber: number,
): ReturnType<typeof findIntentRegionOnLine> {
  const region = findIntentRegionOnLine(view.state, lineNumber);
  if (!region?.stale) return null;
  return region;
}
