export type PreviewGuestAttachMode = 'paint' | 'navigate-hidden';

export function resolvePreviewGuestAttachMode(options: {
  explicitBoundsValid: boolean;
  instanceAlreadyVisible: boolean;
}): PreviewGuestAttachMode {
  if (options.explicitBoundsValid || options.instanceAlreadyVisible) return 'paint';
  return 'navigate-hidden';
}

export function shouldKeepPreviewGuestVisibleAfterCapture(wasVisibleBeforeCapture: boolean): boolean {
  return wasVisibleBeforeCapture;
}
