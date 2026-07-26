/**
 * File viewer context menu items for selection + markdown preview (Phase 4).
 */

import type { FilePanelContextMenuItem } from '../file-tree-context-menu';

export interface FileViewerContextMenuInput {
  path: string;
  hasEditorSelection: boolean;
  isMarkdown: boolean;
  isMarkdownPreview: boolean;
  onAddSelectionToChat: () => void;
  onQuickEdit: () => void;
  onSwitchToCode: () => void;
  onSwitchToPreview: () => void;
  /** Optional: link editor selection to an Issues app card (MIN-261). */
  onLinkToIssue?: () => void;
}

/** Assemble viewer context menu items (selection actions + optional markdown toggles). */
export function buildFileViewerContextMenuItems(
  input: FileViewerContextMenuInput,
): FilePanelContextMenuItem[] {
  const items: FilePanelContextMenuItem[] = [];

  if (input.hasEditorSelection) {
    items.push(
      {
        label: 'Add selection to chat',
        action: input.onAddSelectionToChat,
      },
      {
        label: 'Quick edit',
        action: input.onQuickEdit,
      },
    );
    if (input.onLinkToIssue) {
      items.push({
        label: 'Link to issue…',
        action: input.onLinkToIssue,
      });
    }
  }

  if (input.isMarkdown) {
    if (input.isMarkdownPreview) {
      items.push({
        label: 'Open as code',
        action: input.onSwitchToCode,
      });
    } else {
      items.push({
        label: 'Open as preview',
        action: input.onSwitchToPreview,
      });
    }
  }

  return items;
}
