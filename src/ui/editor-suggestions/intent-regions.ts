import {
  Annotation,
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Transaction,
} from '@codemirror/state';
import {
  changeIntersectsRegion,
  withStaleRegions,
  type IntentRegion,
} from './intent-context';

/** Re-export for consumers. */
export type { IntentRegion } from './intent-context';

/** Debounced staleness refresh (see acceptedIntentStalenessPlugin). */
export const refreshAcceptedIntentStaleness = StateEffect.define<void>();

/** Marks transactions dispatched by intent accept/revert (not user edits). */
export const intentSystemTransaction = Annotation.define<boolean>();

export const addAcceptedIntentRegion = StateEffect.define<IntentRegion>();
export const removeAcceptedIntentRegion = StateEffect.define<{ from: number; to: number }>();

function regionKey(region: Pick<IntentRegion, 'from' | 'to'>): string {
  return `${region.from}:${region.to}`;
}

/**
 * Map accepted regions through document changes; drop regions touched by user edits.
 */
export function mapRegionsThroughTransaction(
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
    if (effect.is(addAcceptedIntentRegion)) {
      next = next.filter((r) => regionKey(r) !== regionKey(effect.value));
      next.push(effect.value);
    } else if (effect.is(removeAcceptedIntentRegion)) {
      const key = regionKey(effect.value);
      next = next.filter((r) => regionKey(r) !== key);
    }
  }

  if (tr.docChanged) {
  }

  return next;
}

export const acceptedIntentRegionsField = StateField.define<IntentRegion[]>({
  create: () => [],
  update(regions, tr) {
    const contextWindow = tr.state.facet(acceptedIntentContextWindowFacet);
    if (tr.effects.some((e) => e.is(refreshAcceptedIntentStaleness))) {
      return withStaleRegions(tr.state.doc, regions, contextWindow);
    }
    return mapRegionsThroughTransaction(regions, tr, contextWindow);
  },
});

export const acceptedIntentContextWindowFacet = Facet.define<number, number>({
  combine: (values) => values[0] ?? 5,
});

/** Read accepted regions (empty when the field is not mounted). */
export function getAcceptedIntentRegions(state: EditorState): IntentRegion[] {
  return state.field(acceptedIntentRegionsField, false) ?? [];
}
