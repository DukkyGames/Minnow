export type PreviewContextMenuRole =
  | 'goBack'
  | 'goForward'
  | 'reload'
  | 'openLinkInNewTab'
  | 'copyLink'
  | 'openExternal'
  | 'copyImage'
  | 'copyImageAddress'
  | 'saveImage'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'replaceMisspelling'
  | 'addToDictionary'
  | 'inspect'
  | 'sendToChat';

export type PreviewContextMenuItem =
  | { type: 'separator' }
  | {
      type: 'item';
      role: PreviewContextMenuRole;
      label: string;
      enabled: boolean;
      suggestion?: string;
    };

export interface PreviewContextMenuParams {
  linkURL?: string;
  srcURL?: string;
  mediaType?: string;
  isEditable?: boolean;
  selectionText?: string;
  misspelledWord?: string;
  dictionarySuggestions?: string[];
  editFlags?: {
    canCut?: boolean;
    canCopy?: boolean;
    canPaste?: boolean;
    canSelectAll?: boolean;
  };
}

export interface BuildPreviewContextMenuItemsInput {
  params: PreviewContextMenuParams;
  canGoBack: boolean;
  canGoForward: boolean;
}

function pushSeparator(items: PreviewContextMenuItem[]): void {
  if (items.length === 0) return;
  const last = items[items.length - 1];
  if (last?.type === 'separator') return;
  items.push({ type: 'separator' });
}

export function buildPreviewContextMenuItems(
  input: BuildPreviewContextMenuItemsInput,
): PreviewContextMenuItem[] {
  const { params, canGoBack, canGoForward } = input;
  const items: PreviewContextMenuItem[] = [];

  items.push(
    { type: 'item', role: 'goBack', label: 'Back', enabled: Boolean(canGoBack) },
    { type: 'item', role: 'goForward', label: 'Forward', enabled: Boolean(canGoForward) },
    { type: 'item', role: 'reload', label: 'Reload', enabled: true },
  );

  const linkURL = typeof params.linkURL === 'string' ? params.linkURL.trim() : '';
  if (linkURL) {
    pushSeparator(items);
    items.push(
      { type: 'item', role: 'openLinkInNewTab', label: 'Open link in new tab', enabled: true },
      { type: 'item', role: 'copyLink', label: 'Copy link address', enabled: true },
      { type: 'item', role: 'openExternal', label: 'Open in external browser', enabled: true },
    );
  }

  const isImage = params.mediaType === 'image';
  const srcURL = typeof params.srcURL === 'string' ? params.srcURL.trim() : '';
  if (isImage) {
    pushSeparator(items);
    items.push(
      { type: 'item', role: 'copyImage', label: 'Copy image', enabled: true },
      {
        type: 'item',
        role: 'copyImageAddress',
        label: 'Copy image address',
        enabled: Boolean(srcURL),
      },
      {
        type: 'item',
        role: 'saveImage',
        label: 'Save image asâ€¦',
        enabled: Boolean(srcURL),
      },
    );
  }

  const flags = params.editFlags ?? {};
  const hasSelection = Boolean(params.selectionText?.trim());
  const showEdit =
    Boolean(params.isEditable) || hasSelection || Boolean(flags.canCopy) || Boolean(flags.canPaste);
  if (showEdit) {
    pushSeparator(items);
    items.push(
      {
        type: 'item',
        role: 'cut',
        label: 'Cut',
        enabled: Boolean(params.isEditable && flags.canCut),
      },
      {
        type: 'item',
        role: 'copy',
        label: 'Copy',
        enabled: Boolean(flags.canCopy ?? hasSelection),
      },
      {
        type: 'item',
        role: 'paste',
        label: 'Paste',
        enabled: Boolean(params.isEditable && flags.canPaste),
      },
      {
        type: 'item',
        role: 'selectAll',
        label: 'Select all',
        enabled: Boolean(flags.canSelectAll ?? true),
      },
    );
  }

  const misspelled = typeof params.misspelledWord === 'string' ? params.misspelledWord.trim() : '';
  const suggestions = Array.isArray(params.dictionarySuggestions)
    ? params.dictionarySuggestions.filter((s) => typeof s === 'string' && s.trim())
    : [];
  if (misspelled) {
    pushSeparator(items);
    for (const suggestion of suggestions.slice(0, 5)) {
      items.push({
        type: 'item',
        role: 'replaceMisspelling',
        label: suggestion,
        enabled: true,
        suggestion,
      });
    }
    items.push({
      type: 'item',
      role: 'addToDictionary',
      label: 'Add to dictionary',
      enabled: true,
    });
  }

  pushSeparator(items);
  items.push(
    { type: 'item', role: 'inspect', label: 'Inspect', enabled: true },
    { type: 'item', role: 'sendToChat', label: 'Send to chat', enabled: true },
  );

  return items;
}
