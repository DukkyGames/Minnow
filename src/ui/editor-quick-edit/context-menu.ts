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
  /**
   * Capture rows contributed by the menu registry ("Create issue…", "Add to
   * issue…"). Passed in rather than imported so this stays a pure builder.
   */
  captureItems?: FilePanelContextMenuItem[];
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
    // Capture supersedes the old prompt-for-an-id flow when it is available;
    // `onLinkToIssue` stays as the fallback so nothing regresses if capture
    // has not been wired on this surface.
    if (input.captureItems?.length) {
      items.push(...input.captureItems);
    } else if (input.onLinkToIssue) {
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
