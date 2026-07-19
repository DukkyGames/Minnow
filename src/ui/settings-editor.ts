/**
 * Settings → Editor: file viewer AI inline completion + Intent mode.
 */

import { renderEditorSettingsSection } from './editor-ai-settings';

/** Render the Editor settings section into #settingsEditorBody. */
export async function renderEditorSection(): Promise<void> {
  await renderEditorSettingsSection();
}
