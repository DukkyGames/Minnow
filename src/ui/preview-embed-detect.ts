export function detectEmbedBlockedFrame(
  frameHref: string,
  bodyText: string,
  options?: { externalUrlMode?: boolean },
): boolean {
  const href = frameHref.trim();
  if (href.startsWith('chrome-error:')) return true;

  const text = bodyText.toLowerCase();
  if (
    text.includes('x-frame-options') ||
    text.includes('frame-ancestors') ||
    text.includes('refused to display') ||
    text.includes('err_blocked_by_response')
  ) {
    return true;
  }

  if (options?.externalUrlMode && href === 'about:blank') {
    return false;
  }

  return false;
}
