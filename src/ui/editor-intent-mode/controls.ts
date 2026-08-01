/**
 * Intent mode decorations and hover controls (MIN-131).
 */

import { RangeSetBuilder, type Text } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import type { IntentRegion } from './types';

export interface IntentDecorationMeta {
  enabled: boolean;
  regions: IntentRegion[];
  resolvingLine: number | null;
  doc: Text;
}

/** Hover affordance with revert / re-resolve actions on resolved lines. */
class IntentControlsWidget extends WidgetType {
  constructor(
    readonly regionKey: string,
    readonly stale: boolean,
  ) {
    super();
  }

  eq(other: IntentControlsWidget): boolean {
    return other.regionKey === this.regionKey && other.stale === this.stale;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-intent-controls';
    wrap.setAttribute('contenteditable', 'false');

    const revertBtn = document.createElement('button');
    revertBtn.type = 'button';
    revertBtn.className = 'cm-intent-control-btn';
    revertBtn.textContent = 'Revert';
    revertBtn.title = 'Revert to intent text';
    revertBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    revertBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dom.dispatchEvent(
        new CustomEvent('minnow-intent-revert', {
          detail: { regionKey: this.regionKey },
          bubbles: true,
        }),
      );
    });

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'cm-intent-control-btn';
    retryBtn.textContent = this.stale ? 'Re-resolve' : 'Retry';
    retryBtn.title = 'Re-resolve from stored intent';
    retryBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    retryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dom.dispatchEvent(
        new CustomEvent('minnow-intent-retry', {
          detail: { regionKey: this.regionKey },
          bubbles: true,
        }),
      );
    });

    wrap.append(revertBtn, retryBtn);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Small spinner shown while a line is resolving. */
class IntentSpinnerWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-intent-spinner';
    span.setAttribute('aria-hidden', 'true');
    span.title = 'Resolving intent…';
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function regionKey(region: IntentRegion): string {
  return `${region.from}:${region.to}`;
}

/** Build line + widget decorations for resolved, pending, and resolving lines. */
export function buildIntentDecorations(
  meta: IntentDecorationMeta,
  _contextWindow: number,
): DecorationSet {
  const { enabled, regions, resolvingLine, doc } = meta;
  if (!enabled) return Decoration.none;

  type DecoEntry = { from: number; to: number; deco: Decoration };
  const entries: DecoEntry[] = [];

  const resolvedLines = new Set<number>();
  for (const region of regions) {
    const line = doc.lineAt(region.from);
    resolvedLines.add(line.number);
    entries.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({
        class: region.stale ? 'cm-intent-line--stale' : 'cm-intent-line--resolved',
      }),
    });
    entries.push({
      from: region.to,
      to: region.to,
      deco: Decoration.widget({
        widget: new IntentControlsWidget(regionKey(region), region.stale),
        side: 1,
      }),
    });
  }

  if (resolvingLine !== null && resolvingLine >= 1 && resolvingLine <= doc.lines) {
    const line = doc.line(resolvingLine);
    entries.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({ class: 'cm-intent-line--resolving' }),
    });
    entries.push({
      from: line.to,
      to: line.to,
      deco: Decoration.widget({ widget: new IntentSpinnerWidget(), side: 1 }),
    });
  }

  for (let n = 1; n <= doc.lines; n += 1) {
    if (resolvedLines.has(n) || resolvingLine === n) continue;
    const line = doc.line(n);
    if (line.text.trim().length === 0) continue;
    entries.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({ class: 'cm-intent-line--pending' }),
    });
  }

  entries.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of entries) {
    builder.add(entry.from, entry.to, entry.deco);
  }
  return builder.finish();
}

/** Parse region key back into from/to (used by control event handlers). */
export function parseRegionKey(key: string): { from: number; to: number } | null {
  const parts = key.split(':');
  if (parts.length !== 2) return null;
  const from = Number(parts[0]);
  const to = Number(parts[1]);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to };
}
