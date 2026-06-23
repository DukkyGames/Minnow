/**
 * Super Plan finish popout — hero, plan preview, and hand-off actions (MIN-235 Wave 4).
 */

import { renderResearchResultFromMarkdown } from '../research/report-view';
import { inferPlanTitleFromMarkdown } from './plan-slug';

export interface SuperPlanFinishPopoutOptions {
  planMarkdown: string;
  planPath: string;
  onRevise: (notes?: string) => void;
  onStartOrchestrator: () => void;
  onSendToBuild: () => void;
  onClose: () => void;
}

const NOOP_REPORT_ACTIONS = {
  onExport: () => {},
  onRunAgain: () => {},
  onDiscuss: () => {},
  onRefine: () => {},
  onFollowUp: () => {},
  onViewLibrary: () => {},
  onAddToBrain: () => {},
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractSummary(markdown: string): string {
  const tldr = markdown.match(/^##\s+TL;DR\s*\n+([\s\S]*?)(?:\n##|\n#|$)/im)?.[1]?.trim();
  if (tldr) {
    return tldr.split('\n')[0]?.trim() ?? tldr;
  }
  const firstPara = markdown
    .replace(/^#.+$/m, '')
    .replace(/^##.+$/gm, '')
    .trim()
    .split(/\n\n+/)[0]
    ?.replace(/\s+/g, ' ')
    .trim();
  return firstPara?.slice(0, 220) ?? 'Your executable plan is ready for orchestration or build.';
}

/** Mount the finish dashboard into `mount`. */
export function mountSuperPlanFinishPopout(
  mount: HTMLElement,
  options: SuperPlanFinishPopoutOptions,
): { destroy: () => void } {
  const title = inferPlanTitleFromMarkdown(options.planMarkdown, options.planPath);
  const summary = extractSummary(options.planMarkdown);

  const root = document.createElement('div');
  root.className = 'sp-finish';

  const panel = document.createElement('div');
  panel.className = 'sp-finish__panel';

  const hero = document.createElement('div');
  hero.className = 'sp-finish__hero';
  hero.innerHTML = `
    <div class="sp-finish__badge" aria-hidden="true">✓</div>
    <div class="sp-finish__hero-copy">
      <h3 class="sp-finish__title">Super Plan ready</h3>
      <p class="sp-finish__subtitle">${escapeHtml(summary)}</p>
      <p class="sp-finish__path sp-mono">${escapeHtml(options.planPath)}</p>
    </div>
  `;
  panel.appendChild(hero);

  const planSection = document.createElement('section');
  planSection.className = 'sp-finish__section';
  const planHeading = document.createElement('h4');
  planHeading.className = 'sp-finish__section-title';
  planHeading.textContent = 'Plan';
  const planBody = document.createElement('div');
  planBody.className = 'sp-finish__plan';
  planSection.appendChild(planHeading);
  planSection.appendChild(planBody);
  panel.appendChild(planSection);

  const reviseWrap = document.createElement('div');
  reviseWrap.className = 'sp-finish__revise';
  reviseWrap.hidden = true;
  reviseWrap.innerHTML = `
    <label class="sp-finish__revise-label" for="sp-finish-revise-notes">Revision notes (optional)</label>
    <textarea id="sp-finish-revise-notes" class="sp-finish__revise-input" rows="3" placeholder="What should change in the next draft?"></textarea>
    <div class="sp-finish__revise-actions">
      <button type="button" class="sp-btn sp-btn-primary" data-sp-submit-revise>Submit revision</button>
      <button type="button" class="sp-btn sp-btn-ghost" data-sp-cancel-revise>Cancel</button>
    </div>
  `;
  panel.appendChild(reviseWrap);

  const footer = document.createElement('footer');
  footer.className = 'sp-finish__footer';
  footer.innerHTML = `
    <div class="sp-finish__actions">
      <button type="button" class="sp-btn sp-btn-ghost" data-sp-revise>Revise</button>
      <button type="button" class="sp-btn sp-btn-primary" data-sp-orchestrate>Start Orchestrator</button>
      <button type="button" class="sp-btn sp-btn-ghost" data-sp-build>Send to Build</button>
      <button type="button" class="sp-btn sp-btn-ghost" data-sp-close>Close</button>
    </div>
  `;
  panel.appendChild(footer);
  root.appendChild(panel);
  mount.replaceChildren(root);

  renderResearchResultFromMarkdown(
    planBody,
    options.planMarkdown,
    [],
    title,
    undefined,
    1,
    NOOP_REPORT_ACTIONS,
    { savedToLibrary: true },
  );

  const reviseWrapEl = reviseWrap;
  const notesInput = reviseWrap.querySelector<HTMLTextAreaElement>('#sp-finish-revise-notes');

  const hideRevise = (): void => {
    reviseWrapEl.hidden = true;
    if (notesInput) {
      notesInput.value = '';
    }
  };

  footer.querySelector('[data-sp-revise]')?.addEventListener('click', () => {
    reviseWrapEl.hidden = false;
    notesInput?.focus();
  });
  reviseWrap.querySelector('[data-sp-cancel-revise]')?.addEventListener('click', hideRevise);
  reviseWrap.querySelector('[data-sp-submit-revise]')?.addEventListener('click', () => {
    const notes = notesInput?.value.trim();
    hideRevise();
    options.onRevise(notes || undefined);
  });

  footer.querySelector('[data-sp-orchestrate]')?.addEventListener('click', () => {
    options.onStartOrchestrator();
  });
  footer.querySelector('[data-sp-build]')?.addEventListener('click', () => {
    options.onSendToBuild();
  });
  footer.querySelector('[data-sp-close]')?.addEventListener('click', () => {
    options.onClose();
  });

  return {
    destroy: () => {
      mount.replaceChildren();
    },
  };
}
