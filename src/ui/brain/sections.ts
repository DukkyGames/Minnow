/**
 * Lazy-render Brain app section panels.
 */

import type { BrainSectionId } from '../brain-page';
import { renderCodeSection } from './code-section';
import { renderEditSection } from './edit-section';
import { renderIngestSection } from './ingest-section';
import { renderLintSection } from './lint-section';
import { renderLogSection } from './log-section';
import { renderProposalsSection } from './proposals-section';
import { renderSchemaSection } from './schema-section';
import { renderSettingsSection } from './settings-section';
import { renderGraphSection } from './graph-section';

/** Render a Brain section on first activation. */
export async function renderBrainSection(
  section: BrainSectionId,
  options?: { editPath?: string },
): Promise<void> {
  switch (section) {
    case 'graph':
      await renderGraphSection();
      break;
    case 'edit':
      await renderEditSection(options?.editPath);
      break;
    case 'log':
      await renderLogSection();
      break;
    case 'schema':
      await renderSchemaSection();
      break;
    case 'proposals':
      await renderProposalsSection();
      break;
    case 'ingest':
      renderIngestSection();
      break;
    case 'lint':
      await renderLintSection();
      break;
    case 'code':
      await renderCodeSection();
      break;
    case 'settings':
      await renderSettingsSection();
      break;
    default:
      break;
  }
}
