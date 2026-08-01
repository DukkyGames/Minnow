/**
 * CodeMirror state for Intent mode resolved regions (MIN-131).
 */

import {
  Annotation,
  Compartment,
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import { forEachDiagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import {
  buildIntentDecorations,
  type IntentDecorationMeta,
} from './controls';
import {
  changeIntersectsRegion,
  withStale,
} from './context';
import type { IntentRegion } from './types';
import type { EditorIntentModeConfig } from '../../config/editor-intent-mode';
import { DEFAULT_EDITOR_INTENT_MODE } from '../../config/editor-intent-mode';

/** Marks transactions dispatched by Intent mode (resolve/revert/retry). */
export const intentSystemTransaction = Annotation.define<boolean>();

export interface IntentModeEditorState {
  enabled: boolean;
  regions: IntentRegion[];
  /** 1-based line number currently being resolved, or null. */
  resolvingLine: number | null;
}

export const addIntentRegion = StateEffect.define<IntentRegion>();
export const updateIntentRegion = StateEffect.define<IntentRegion>();
export const removeIntentRegion = StateEffect.define<{ from: number; to: number }>();
export const setIntentModeEnabled = StateEffect.define<boolean>();
export const setResolvingLine = StateEffect.define<number | null>();

export const intentModeEnabledCompartment = new Compartment();

const emptyState = (): IntentModeEditorState => ({
  enabled: false,
  regions: [],
  resolvingLine: null,
});

function regionKey(region: Pick<IntentRegion, 'from' | 'to'>): string {
  return `${region.from}:${region.to}`;
}

/** Map regions through document changes; drop regions touched by user edits. */
function mapRegionsThroughTransaction(
  regions: IntentRegion[],
  tr: Transaction,
  contextWindow: number,
): IntentRegion[] {
  const isSystem = tr.annotation(intentSystemTransaction) === true;
  let next: IntentRegion[] = [];

  for (const region of regions) {
    let dropped = false;
    if (tr.docChanged && !isSystem) {
      tr.changes.iterChangedRanges((changeFrom, changeTo) => {
        if (changeIntersectsRegion(changeFrom, changeTo, region.from, region.to)) {
          dropped = true;
        }
      });
    }
    if (dropped) continue;

    const from = tr.changes.mapPos(region.from, 1);
    const to = tr.changes.mapPos(region.to, -1);
    if (from >= to) continue;
    next.push({ ...region, from, to });
  }

  for (const effect of tr.effects) {
    if (effect.is(addIntentRegion)) {
      next = next.filter((r) => regionKey(r) !== regionKey(effect.value));
      next.push(effect.value);
    } else if (effect.is(updateIntentRegion)) {
      next = next.filter((r) => regionKey(r) !== regionKey(effect.value));
      next.push(effect.value);
    } else if (effect.is(removeIntentRegion)) {
      const key = regionKey(effect.value);
      next = next.filter((r) => regionKey(r) !== key);
    }
  }

  if (tr.docChanged) {
    next = withStale(tr.newDoc.toString(), next, contextWindow);
  }

  return next;
}

/** StateField holding resolved regions + mode flag; provides line decorations. */
export const intentModeField = StateField.define<IntentModeEditorState>({
  create: () => emptyState(),
  update(value, tr) {
    let enabled = value.enabled;
    let resolvingLine = value.resolvingLine;

    for (const effect of tr.effects) {
      if (effect.is(setIntentModeEnabled)) enabled = effect.value;
      if (effect.is(setResolvingLine)) resolvingLine = effect.value;
    }

    const config = tr.state.facet(intentModeConfigFacet);
    const regions = mapRegionsThroughTransaction(value.regions, tr, config.contextWindow);

    return { enabled, regions, resolvingLine };
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const row = state.field(field);
      const config = state.facet(intentModeConfigFacet);
      const meta: IntentDecorationMeta = {
        enabled: row.enabled,
        regions: row.regions,
        resolvingLine: row.resolvingLine,
        doc: state.doc,
      };
      return buildIntentDecorations(meta, config.contextWindow);
    }),
});

/** Per-editor Intent mode tuning from config (context window, etc.). */
export const intentModeConfigFacet = Facet.define<
  EditorIntentModeConfig,
  EditorIntentModeConfig
>({
  combine: (values) => values[0] ?? DEFAULT_EDITOR_INTENT_MODE,
});

/** Whether Intent mode is active for this editor. */
export function isIntentModeEnabled(state: EditorState): boolean {
  const row = state.field(intentModeField, false);
  return row?.enabled === true;
}

/** Count of stale resolved regions. */
export function getIntentStaleCount(state: EditorState): number {
  const row = state.field(intentModeField, false);
  if (!row) return 0;
  return row.regions.filter((r) => r.stale).length;
}

/** Find a resolved region covering a document position. */
export function findIntentRegionAt(
  state: EditorState,
  pos: number,
): IntentRegion | null {
  const row = state.field(intentModeField, false);
  if (!row) return null;
  return row.regions.find((r) => pos >= r.from && pos <= r.to) ?? null;
}

/** Find region on a given 1-based line number. */
export function findIntentRegionOnLine(
  state: EditorState,
  lineNumber: number,
): IntentRegion | null {
  const row = state.field(intentModeField, false);
  if (!row) return null;
  const line = state.doc.line(lineNumber);
  return row.regions.find((r) => r.from <= line.from && r.to >= line.to) ?? null;
}

/** True when the line is covered by a resolved region. */
export function isLineResolved(state: EditorState, lineNumber: number): boolean {
  return findIntentRegionOnLine(state, lineNumber) !== null;
}

/** True when LSP/CodeMirror reports an error diagnostic overlapping a line span. */
function lineHasErrorDiagnostic(state: EditorState, lineFrom: number, lineTo: number): boolean {
  let hasError = false;
  forEachDiagnostic(state, (diag) => {
    if (diag.severity !== 'error') return;
    if (diag.from <= lineTo && diag.to >= lineFrom) hasError = true;
  });
  return hasError;
}

/**
 * Skip automatic resolve when the line is unchanged resolved code (region spans the
 * full line). Retries pass intentOverride and always run.
 */
export function shouldSkipIntentResolve(
  state: EditorState,
  lineNumber: number,
  intentOverride?: string,
): boolean {
  if (intentOverride) return false;
  const region = findIntentRegionOnLine(state, lineNumber);
  if (!region) return false;
  const line = state.doc.line(lineNumber);
  if (region.from !== line.from || region.to !== line.to) return false;
  const lineText = state.doc.sliceString(line.from, line.to).trim();
  if (lineText.length === 0) return false;
  // Line still shows stored intent (e.g. user reverted text but region not cleared yet).
  if (lineText === region.intentText.trim()) return false;
  // Re-resolve when the line still has a syntax/type error (broken generated code).
  if (lineHasErrorDiagnostic(state, line.from, line.to)) return false;
  return true;
}

/** Initialize enabled flag for a newly mounted editor. */
export function intentModeInitialEffect(enabled: boolean): StateEffect<boolean> {
  return setIntentModeEnabled.of(enabled);
}

/** Compartment wrapper for optional Intent mode plugin bundle. */
export function intentModeCompartmentExtension(active: Extension[]): Extension {
  return intentModeEnabledCompartment.of(active);
}
