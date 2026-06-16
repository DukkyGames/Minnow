/**
 * Brain app — Proposals section: reuse memory/skill synthesis review panel.
 */

import { mountMemoryProposalsPanel } from '../memory-proposals-panel';

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
  }, {
    list: '#brainProposalsList',
    offline: '#brainProposalsOffline',
    count: '#brainProposalsCount',
  });
}
