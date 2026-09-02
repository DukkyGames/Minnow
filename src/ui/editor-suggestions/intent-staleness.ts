import { ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { docChangeTouchesRegionWindow } from './intent-context';
import {
  acceptedIntentContextWindowFacet,
  getAcceptedIntentRegions,
  refreshAcceptedIntentStaleness,
} from './intent-regions';

/** Idle debounce before recomputing ctxHash drift on accepted regions. */
const STALE_IDLE_MS = 400;

export function acceptedIntentStalenessPlugin() {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;

      update(update: ViewUpdate): void {
        if (!update.docChanged) return;
        const regions = getAcceptedIntentRegions(update.state);
        if (regions.length === 0) return;

        const contextWindow = update.state.facet(acceptedIntentContextWindowFacet);
        const doc = update.startState.doc;
        let touched = false;
        for (const tr of update.transactions) {
          if (!tr.docChanged) continue;
          tr.changes.iterChangedRanges((from, to) => {
            if (touched) return;
            for (const region of regions) {
              if (docChangeTouchesRegionWindow(doc, region, contextWindow, from, to)) {
                touched = true;
                return;
              }
            }
          });
        }
        if (!touched) return;
        this.schedule(update.view);
      }

      destroy(): void {
        if (this.timer) clearTimeout(this.timer);
      }

      schedule(view: import('@codemirror/view').EditorView): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          view.dispatch({ effects: refreshAcceptedIntentStaleness.of() });
        }, STALE_IDLE_MS);
      }
    },
  );
}
