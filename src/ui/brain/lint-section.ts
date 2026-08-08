/**
 * Brain app — Lint section: run POST /lint and render the health report.
 */

import { lintBrainWiki, pruneBrainWeakLinks } from '../../brain/client';
import type { BrainLintReport, BrainPruneLinksReport } from '../../brain/types';
import { renderBrainEmptyState, renderBrainLoading } from './empty-state';
import { navigateBrainGraphPage, setGraphOrphanPaths } from './graph-section';
import { openBrain } from '../brain-page';
import { appConfirm } from '../app-dialog';

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

/**
 * Weak-link cleanup: report first, then confirm. Pages linked before the
 * similarity floors existed carry `similarTo` edges built from a single shared
 * title word, so this always shows what it would drop before dropping it.
 */
function renderWeakLinksGroup(mount: HTMLElement, report: BrainPruneLinksReport | null): void {
  const section = document.createElement('section');
  section.className = 'brain-lint-group';
  section.dataset.lintGroup = 'weak-links';

  const heading = document.createElement('h4');
  heading.className = 'brain-section-subtitle';
  heading.textContent = 'Weak links';
  section.append(heading);

  if (!report) {
    const hint = document.createElement('p');
    hint.className = 'brain-muted';
    hint.textContent =
      'Re-score existing similar-page links against the current similarity thresholds.';
    section.append(hint);

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'brain-action-btn';
    checkBtn.textContent = 'Check weak links';
    checkBtn.addEventListener('click', () => {
      void runPrune(false);
    });
    section.append(checkBtn);
    mount.append(section);
    return;
  }

  const meta = document.createElement('p');
  meta.className = 'brain-muted';
  const droppedCount = report.removals.reduce((sum, row) => sum + row.dropped.length, 0);
  meta.textContent = report.dryRun
    ? `${droppedCount} of ${report.edgesScanned} links on ${report.removals.length} pages fall below the threshold.`
    : `Removed ${droppedCount} links across ${report.applied.length} pages.`;
  section.append(meta);

  if (report.removals.length > 0) {
    const list = document.createElement('ul');
    list.className = 'brain-lint-list';
    for (const row of report.removals) {
      const li = document.createElement('li');
      li.textContent = `${row.path} — drops ${row.dropped.join(', ')}${
        row.kept.length > 0 ? ` (keeps ${row.kept.join(', ')})` : ''
      }`;
      list.append(li);
    }
    section.append(list);
  }

  if (report.dryRun && report.removals.length > 0) {
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'brain-action-btn';
    applyBtn.textContent = 'Remove weak links';
    applyBtn.addEventListener('click', () => {
      void (async () => {
        const ok = await appConfirm(
          `Remove ${droppedCount} similar-page links from ${report.removals.length} pages? This rewrites page frontmatter.`,
        );
        if (ok) void runPrune(true);
      })();
    });
    section.append(applyBtn);
  }

  mount.append(section);
}

function renderLintReport(
  mount: HTMLElement,
  report: BrainLintReport,
  pruneReport: BrainPruneLinksReport | null = null,
): void {
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
  renderWeakLinksGroup(mount, pruneReport);

  const hasActionable =
    report.orphans.length > 0 || report.stale.length > 0 || report.contradictions.length > 0;
  if (hasActionable) {
    const cleanBtn = document.createElement('button');
    cleanBtn.type = 'button';
    cleanBtn.className = 'brain-action-btn';
    cleanBtn.textContent = 'Clean up';
    cleanBtn.addEventListener('click', () => {
      void (async () => {
        const ok = await appConfirm(
          "Mark orphans stale and delete pages already marked stale. This deletes files and can't be undone.",
          { confirmLabel: 'Clean up', danger: true },
        );
        if (ok) void runCleanup();
      })();
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
    err.textContent = 'Lint failed. Open Minnow and try again.';
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
    err.textContent = 'Cleanup failed. Open Minnow and try again.';
    mount.append(err);
    return;
  }

  renderLintReport(mount, report);
  mount.dataset.lintRan = '1';
}

/**
 * Run the weak-link pass and swap the result into the existing report in place,
 * so checking links doesn't re-trigger the LLM contradiction scan.
 */
async function runPrune(apply: boolean): Promise<void> {
  const mount = document.getElementById('brainLintBody');
  const existing = mount?.querySelector<HTMLElement>('[data-lint-group="weak-links"]');
  if (!mount || !existing) return;

  const busy = document.createElement('section');
  busy.className = 'brain-lint-group';
  busy.dataset.lintGroup = 'weak-links';
  const busyText = document.createElement('p');
  busyText.className = 'brain-muted';
  busyText.textContent = apply ? 'Removing weak links…' : 'Scoring links…';
  busy.append(busyText);
  existing.replaceWith(busy);

  const report = await pruneBrainWeakLinks({ apply });

  const holder = document.createElement('div');
  if (report) {
    renderWeakLinksGroup(holder, report);
  } else {
    const err = document.createElement('section');
    err.className = 'brain-lint-group';
    err.dataset.lintGroup = 'weak-links';
    const msg = document.createElement('p');
    msg.className = 'brain-error';
    msg.textContent = 'Link check failed. Open Minnow and try again.';
    err.append(msg);
    holder.append(err);
  }
  busy.replaceWith(...holder.children);
}

let lintToolbarBound = false;

/** Show lint intro; empty-state CTA runs the health check. */
export async function renderLintSection(): Promise<void> {
  if (!lintToolbarBound) {
    lintToolbarBound = true;
    document.getElementById('brainLintRun')?.addEventListener('click', () => {
      void runLint();
    });
  }

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
