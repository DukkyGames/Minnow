/**
 * CodeMirror dragstart: selection → composer code-reference chips.
 */

<<<<<<< HEAD
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
=======
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
>>>>>>> 6a489be8 (tmp: worktree apply snapshot)
import { setCodeSelectionDragData } from '../attachments/code-selection-drag';
import { lineNumbersForRange } from './editor-quick-edit/selection-fence';

/** Wire editor selection drags to the composer code-selection MIME payload. */
export function codeSelectionDragExtension(workspacePath: string): Extension {
  const path = workspacePath.trim().replace(/\\/g, '/');
  return EditorView.domEventHandlers({
    dragstart(event, view) {
      const sel = view.state.selection.main;
      if (sel.empty) return false;
      const transfer = event.dataTransfer;
      if (!transfer) return false;
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (!text.trim()) return false;
      const { fromLine, toLine } = lineNumbersForRange(view.state.doc, sel.from, sel.to);
      setCodeSelectionDragData(transfer, {
        workspacePath: path,
        startLine: fromLine,
        endLine: toLine,
        text,
      });
      return false;
    },
  });
}
