/**
 * Brain app — Lint section: run POST /lint and render the health report.
 */

import { lintBrainWiki } from '../../brain/client';
import type { BrainLintReport } from '../../brain/types';
import { navigateBrainGraphPage, setGraphOrphanPaths } from './graph-section';
import { openBrain } from '../brain-page';

let bindingsDone = false;

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

function renderLintReport(mount: HTMLElement, report: BrainLintReport): void {
  mount.replaceChildren();

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
}

function bindLintSection(): void {
  if (bindingsDone) return;
  bindingsDone = true;
  document.getElementById('brainLintRun')?.addEventListener('click', () => {
    void runLint();
  });
}

async function runLint(): Promise<void> {
  const mount = document.getElementById('brainLintBody');
  const offlineEl = document.getElementById('brainLintOffline');
  if (!mount) return;

  mount.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'brain-muted';
  loading.textContent = 'Running lint…';
  mount.append(loading);

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

/** Show lint intro; run button wired once. */
export async function renderLintSection(): Promise<void> {
  bindLintSection();
  const mount = document.getElementById('brainLintBody');
  if (!mount || mount.dataset.lintRan === '1') return;
  mount.replaceChildren();
  const lead = document.createElement('p');
  lead.className = 'brain-muted';
  lead.textContent =
    'Check orphans, stale pages, broken wikilinks, and optional LLM contradiction scan.';
  mount.append(lead);
}

export { runLint };
