/**
 * Brain app — Lint section: run POST /lint and render the health report.
 */

import { lintBrainWiki } from '../../brain/client';
import type { BrainLintReport } from '../../brain/types';
import { renderBrainEmptyState, renderBrainLoading } from './empty-state';
import { navigateBrainGraphPage, setGraphOrphanPaths } from './graph-section';
import { openBrain } from '../brain-page';

function renderIssueList(
  mount: HTMLElement,
  title: string,
  rows: Array<{
    path?: string;
    from?: string;
    target?: string;
    summary?: string;
    pages?: string[];
    title?: string;
  }>,
  emptyText: string,
  options?: { graphLink?: boolean },
): void {
  const section = document.createElement('section');
  section.className = 'brain-lint-group';
  const headingRow = document.createElement('div');
  headingRow.className = 'brain-lint-group__head';
  const heading = document.createElement('h4');
  heading.className = 'brain-section-subtitle';
  heading.textContent = title;
  headingRow.append(heading);

  if (options?.graphLink && title === 'Orphans' && rows.length > 0) {
    const graphBtn = document.createElement('button');
    graphBtn.type = 'button';
    graphBtn.className = 'brain-action-btn';
    graphBtn.textContent = 'View in graph';
    graphBtn.addEventListener('click', () => {
      const paths = rows.map((r) => r.path).filter(Boolean) as string[];
      setGraphOrphanPaths(paths);
      openBrain('graph');
    });
    headingRow.append(graphBtn);
  }
  section.append(headingRow);

  if (!rows.length) {
    const ok = document.createElement('p');
    ok.className = 'brain-muted';
    ok.textContent = emptyText;
    section.append(ok);
    mount.append(section);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'brain-lint-list';
  for (const row of rows) {
    const li = document.createElement('li');
    if (row.path) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'brain-inline-link';
      btn.textContent = row.path;
      btn.addEventListener('click', () => navigateBrainGraphPage(row.path!));
      li.append(btn);
    } else if (row.from && row.target) {
      li.textContent = `${row.from} → [[${row.target}]]: ${row.summary}`;
    } else if (row.pages?.length) {
      li.textContent = `${row.pages.join(', ')}: ${row.summary ?? ''}`;
    } else {
      li.textContent = row.summary ?? row.title ?? row.path ?? '';
    }
    list.append(li);
  }
  section.append(list);
  mount.append(section);
}

function renderAppliedSummary(mount: HTMLElement, applied: Array<{ path: string; action: string }>): void {
  const section = document.createElement('section');
  section.className = 'brain-lint-group brain-lint-applied';
  const heading = document.createElement('h4');
  heading.className = 'brain-section-subtitle';
  heading.textContent = 'Applied';
  section.append(heading);

  if (!applied.length) {
    const empty = document.createElement('p');
    empty.className = 'brain-muted';
    empty.textContent = 'Nothing to clean up.';
    section.append(empty);
    mount.append(section);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'brain-lint-list';
  for (const item of applied) {
    const li = document.createElement('li');
    li.textContent = `${item.path} — ${item.action}`;
    list.append(li);
  }
  section.append(list);
  mount.append(section);
}

function renderLintReport(mount: HTMLElement, report: BrainLintReport): void {
  mount.replaceChildren();

  if (report.applied) {
    renderAppliedSummary(mount, report.applied);
  }

  const meta = document.createElement('p');
  meta.className = 'brain-muted';
  meta.textContent = `${report.pageCount} pages · ${new Date(report.generatedAt).toLocaleString()}`;
  mount.append(meta);

  renderIssueList(mount, 'Orphans', report.orphans.map((o) => ({ ...o, summary: o.title })), 'No orphan pages.', {
    graphLink: true,
  });
  renderIssueList(mount, 'Stale', report.stale.map((o) => ({ ...o, summary: o.title })), 'No stale pages.');
  renderIssueList(
    mount,
    'Anchor drift',
    (report.anchorDrift ?? []).map((d) => ({ path: d.path, summary: d.summary })),
    'All anchored symbols match the code index.',
  );
  renderIssueList(mount, 'Missing links', report.missingLinks, 'All wikilinks resolve.');
  renderIssueList(
    mount,
    'Contradictions',
    report.contradictions,
    'No contradictions flagged.',
  );

  const hasActionable =
    report.orphans.length > 0 || report.stale.length > 0 || report.contradictions.length > 0;
  if (hasActionable) {
    const cleanBtn = document.createElement('button');
    cleanBtn.type = 'button';
    cleanBtn.className = 'brain-action-btn';
    cleanBtn.textContent = 'Clean up';
    cleanBtn.addEventListener('click', () => {
      const ok = confirm(
        "Mark orphans stale and delete pages already marked stale. This deletes files and can't be undone.",
      );
      if (ok) void runCleanup();
    });
    mount.append(cleanBtn);
  }
}

async function runLint(): Promise<void> {
  const mount = document.getElementById('brainLintBody');
  const offlineEl = document.getElementById('brainLintOffline');
  if (!mount) return;

  renderBrainLoading(mount, 'Running lint…');

  const report = await lintBrainWiki({ includeLlm: true });
  offlineEl?.classList.toggle('hidden', report !== null);

  if (!report) {
    mount.replaceChildren();
    const err = document.createElement('p');
    err.className = 'brain-error';
    err.textContent = 'Lint failed. Start npm start and try again.';
    mount.append(err);
    return;
  }

  renderLintReport(mount, report);
  // Guard in renderLintSection() checks this flag to preserve the report on re-entry.
  mount.dataset.lintRan = '1';
}

async function runCleanup(): Promise<void> {
  const mount = document.getElementById('brainLintBody');
  const offlineEl = document.getElementById('brainLintOffline');
  if (!mount) return;

  renderBrainLoading(mount, 'Cleaning up…');

  const report = await lintBrainWiki({ includeLlm: true, apply: true });
  offlineEl?.classList.toggle('hidden', report !== null);

  if (!report) {
    mount.replaceChildren();
    const err = document.createElement('p');
    err.className = 'brain-error';
    err.textContent = 'Cleanup failed. Start npm start and try again.';
    mount.append(err);
    return;
  }

  renderLintReport(mount, report);
  mount.dataset.lintRan = '1';
}

/** Show lint intro; empty-state CTA runs the health check. */
export async function renderLintSection(): Promise<void> {
  const mount = document.getElementById('brainLintBody');
  if (!mount || mount.dataset.lintRan === '1') return;
  renderBrainEmptyState(mount, {
    icon: 'sparkle',
    title: 'Wiki health check',
    message:
      'Check orphans, stale pages, broken wikilinks, and optional LLM contradiction scan.',
    ctaLabel: 'Run lint',
    onCta: () => {
      void runLint();
    },
  });
}

export { runLint };
