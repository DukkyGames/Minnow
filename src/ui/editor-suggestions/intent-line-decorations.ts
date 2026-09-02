import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { classifyIntentLine, isIntentEligibleLanguage, lineCommentForLanguage } from './intent-heuristic';
import { getIntentSuggestion, isIntentEnabled } from './state';
import { acceptedIntentRegionsField, getAcceptedIntentRegions } from './intent-regions';
import { resolveLanguageDescription } from '../editor-language';
import type { EditorIntentModeConfig } from '../../config/editor-intent-mode';

export interface IntentLineDecorationOptions {
  filePath: string;
  getIntentConfig: () => EditorIntentModeConfig;
}

function buildCursorLineDecorations(
  view: EditorView,
  opts: IntentLineDecorationOptions,
): DecorationSet {
  const { state } = view;
  if (!isIntentEnabled(state)) return Decoration.none;

  const head = state.selection.main.head;
  let decorates = false;
  for (const { from, to } of view.visibleRanges) {
    if (head >= from && head <= to) {
      decorates = true;
      break;
    }
  }
  if (!decorates) return Decoration.none;

  const line = state.doc.lineAt(head);
  const builder = new RangeSetBuilder<Decoration>();

  const proposal = getIntentSuggestion(state);
  if (proposal && proposal.from === line.from && proposal.to === line.to) {
    builder.add(line.from, line.from, Decoration.line({ class: 'cm-intent-source' }));
    return builder.finish();
  }

  const regions = getAcceptedIntentRegions(state);
  const region = regions.find((r) => r.from <= line.from && r.to >= line.to);
  if (region) {
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: region.stale ? 'cm-intent-line--stale' : 'cm-intent-line--resolved',
      }),
    );
    return builder.finish();
  }

  const languageName = resolveLanguageDescription(opts.filePath)?.name ?? null;
  if (!isIntentEligibleLanguage(languageName)) return Decoration.none;

  const intentConfig = opts.getIntentConfig();
  const kind = classifyIntentLine(line.text, {
    sigil: intentConfig.sigil,
    lineComment: lineCommentForLanguage(languageName) ?? undefined,
  });
  if (kind === 'intent' && line.text.trim().length > 0) {
    builder.add(line.from, line.from, Decoration.line({ class: 'cm-intent-line--pending' }));
  }

  return builder.finish();
}

/** ViewPlugin that repaints intent line classes for the cursor line in view. */
export function intentLineDecorationPlugin(opts: IntentLineDecorationOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;

      constructor(readonly view: EditorView) {
        this.decorations = buildCursorLineDecorations(view, opts);
      }

      update(update: ViewUpdate): void {
        const regionsChanged =
          update.startState.field(acceptedIntentRegionsField, false) !==
          update.state.field(acceptedIntentRegionsField, false);
        if (
          !update.docChanged &&
          !update.selectionSet &&
          !update.viewportChanged &&
          !regionsChanged
        ) {
          return;
        }
        this.decorations = buildCursorLineDecorations(this.view, opts);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
