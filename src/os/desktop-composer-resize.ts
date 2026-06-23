/** Desktop composer grows with content; caps at eight lines then scrolls. */
export const DESKTOP_COMPOSER_MAX_LINES = 8;

function desktopComposerMaxHeightPx(textarea: HTMLTextAreaElement): number {
  const style = getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const paddingTop = Number.parseFloat(style.paddingTop);
  const paddingBottom = Number.parseFloat(style.paddingBottom);
  const borderTop = Number.parseFloat(style.borderTopWidth);
  const borderBottom = Number.parseFloat(style.borderBottomWidth);
  if (!Number.isFinite(lineHeight)) {
    // 16px font × 1.35 line-height × 8 lines + 20px vertical padding
    return 193;
  }
  return Math.ceil(
    lineHeight * DESKTOP_COMPOSER_MAX_LINES +
      paddingTop +
      paddingBottom +
      borderTop +
      borderBottom,
  );
}

/** Grow #desktopInput to fit lines; scroll internally after the eight-line cap. */
export function autoResizeDesktopComposer(textarea: HTMLTextAreaElement): void {
  const maxPx = desktopComposerMaxHeightPx(textarea);
  const previousMaxHeight = textarea.style.maxHeight;
  // Unconstrain height so scrollHeight reflects full content (max-height + flex fight this).
  textarea.style.maxHeight = 'none';
  textarea.style.overflowY = 'hidden';
  textarea.style.height = '0px';
  const contentHeight = textarea.scrollHeight;
  textarea.style.maxHeight = previousMaxHeight;

  if (contentHeight <= maxPx) {
    textarea.style.height = `${contentHeight}px`;
    textarea.style.overflowY = 'hidden';
    textarea.classList.remove('mn-os-desktop-field--scrollable');
    return;
  }

  textarea.style.height = `${maxPx}px`;
  textarea.style.overflowY = 'auto';
  textarea.classList.add('mn-os-desktop-field--scrollable');
}
