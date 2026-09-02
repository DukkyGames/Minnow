import {
  disableDesignMode,
  isDesignModeEnabled,
} from '../design/design-mode';
import { WORKSPACE_PREVIEW_SECONDARY_INSTANCE } from './right-pane-split';
import {
  syncDesignModeGuestForInstance,
  toggleDesignModeForInstance,
  teardownSecondaryDesignModeGuest,
} from './preview-design-instance';

export { teardownSecondaryDesignModeGuest };

function getSecondaryDesignToggleButton(): HTMLButtonElement | null {
  return document.getElementById('btnPreviewDesignToggleSecondary') as HTMLButtonElement | null;
}

/** Wire secondary preview Design Mode toolbar (call once from file-panel init). */
export function bindSecondaryPreviewDesignControls(): void {
  document.getElementById('btnPreviewDesignToggleSecondary')?.addEventListener('click', () => {
    void toggleDesignModeForInstance(
      WORKSPACE_PREVIEW_SECONDARY_INSTANCE,
      getSecondaryDesignToggleButton,
    );
  });
}

/** Show/hide secondary Design Mode affordance (desktop drawer disables both panes). */
export async function syncSecondaryPreviewDesignToolbarForSurface(): Promise<void> {
  const { isPreviewDesignModeAvailable } = await import('./preview-panel');
  const available = await isPreviewDesignModeAvailable();
  const designBtn = getSecondaryDesignToggleButton();
  if (designBtn) designBtn.hidden = !available;

  if (available) return;

  if (!isDesignModeEnabled(WORKSPACE_PREVIEW_SECONDARY_INSTANCE)) return;

  disableDesignMode(WORKSPACE_PREVIEW_SECONDARY_INSTANCE);
  designBtn?.setAttribute('aria-pressed', 'false');
  designBtn?.classList.remove('is-active');
  await syncDesignModeGuestForInstance(WORKSPACE_PREVIEW_SECONDARY_INSTANCE);
}
