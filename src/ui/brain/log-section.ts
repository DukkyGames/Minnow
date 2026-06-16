/**
 * Brain app — Log section: read-only render of log.md.
 */

import { fetchBrainLog } from '../../brain/client';
import { renderBrainMarkdown } from './wikilink-markdown';
import { renderBrainLoading } from './empty-state';
import { navigateBrainGraphPage } from './graph-section';

/** Render the wiki changelog. */
export async function renderLogSection(): Promise<void> {
  const mount = document.getElementById('brainLogBody');
  const offlineEl = document.getElementById('brainLogOffline');
  if (!mount) return;

  renderBrainLoading(mount, 'Loading changelog…');
  const log = await fetchBrainLog();
  const online = log !== null;
  offlineEl?.classList.toggle('hidden', online);

  mount.replaceChildren();
  if (!online) {
    const note = document.createElement('p');
    note.className = 'brain-muted';
    note.textContent = 'Start npm start to view the wiki log.';
    mount.append(note);
    return;
  }

  renderBrainMarkdown(mount, log ?? '', navigateBrainGraphPage);
}
