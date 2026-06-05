/**
 * Workspace-wide agent code change display (hub strip + optional hooks).
 */

import { getWorkspacePath } from '../state/workspace';
import { sessionState } from '../state/sessions';
import {
  formatCodeChangeTotalsText,
  getWorkspaceCodeChangeTotals,
  hasCodeChangeTotals,
} from '../usage/code-change-ledger';

/** Update hub / sidebar workspace agent-change labels when present. */
export function updateWorkspaceCodeChangeDisplay(): void {
  const workspacePath = getWorkspacePath();
  const totals = getWorkspaceCodeChangeTotals(sessionState, workspacePath);

  const hubEl = document.getElementById('hubAgentChangesValue');
  if (hubEl) {
    if (hasCodeChangeTotals(totals)) {
      hubEl.textContent = formatCodeChangeTotalsText(totals);
      hubEl.closest('.hub-strip__cell')?.classList.remove('hidden');
    } else {
      hubEl.textContent = '—';
    }
  }
}
