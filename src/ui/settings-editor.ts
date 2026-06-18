/**
 * Settings → Editor: file viewer AI inline completion + Intent mode.
 */

import { renderEditorSettingsSection } from './editor-ai-settings';
import { appendEditorIntentSettings } from './editor-intent-settings';

/** Render the Editor settings section into #settingsEditorBody. */
export async function renderEditorSection(): Promise<void> {
  await renderEditorSettingsSection();
  const mount = document.getElementById('settingsEditorBody');
  if (!mount) return;
  appendEditorIntentSettings(mount, () => {
    void renderEditorSection();
  });
}
