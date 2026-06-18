/**
 * Brain app — Proposals section: reuse memory/skill synthesis review panel.
 */

import { mountMemoryProposalsPanel } from '../memory-proposals-panel';
import { renderBrainEmptyState } from './empty-state';
import { openBrain } from '../brain-page';

type StatusFn = (kind: 'ok' | 'err' | 'spin', message: string) => void;

const setProposalsStatus: StatusFn = (kind, message) => {
  const el = document.getElementById('brainProposalsStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
};

/** Mount the proposals review list inside the Brain app. */
export async function renderProposalsSection(): Promise<void> {
  const panel = document.getElementById('brainProposalsPanel');
  if (!panel) return;
  await mountMemoryProposalsPanel(panel, setProposalsStatus, {
    onMemoryAccepted: () => {
      void import('./graph-section').then((m) => m.renderGraphSection());
    },
    renderEmpty: (mount) => {
      renderBrainEmptyState(mount, {
        icon: 'inbox',
        title: "You're all caught up",
        message: 'No pending synthesis proposals. Ingest new sources to generate wiki pages.',
        ctaLabel: 'Go to Ingest',
        onCta: () => openBrain('ingest'),
      });
    },
  }, {
    list: '#brainProposalsList',
    offline: '#brainProposalsOffline',
    count: '#brainProposalsCount',
  });
}
