/**
 * Structured research brief view (handoff ReportView) rendered into #researchResultMount.
 */

import type { ParsedBrief } from './parse-brief';
import { parseResearchBrief } from './parse-brief';
import type { ResearchSource, ResearchStats } from './types';

export interface ReportViewActions {
  onExport: () => void;
  onRunAgain: () => void;
  onDiscuss: () => void;
  onRefine: () => void;
  onFollowUp: (query: string) => void;
  onViewLibrary: () => void;
  onAddToBrain: () => void;
}

export interface ReportViewOptions {
  /** Completed runs are auto-persisted — hide the redundant Save control when true. */
  savedToLibrary?: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatClock(seconds?: number): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatStatsLine(stats: ResearchStats | undefined, sourceCount: number, round: number): string {
  const dur = stats?.durationSeconds != null ? formatClock(stats.durationSeconds) : '—';
  const scanned = stats?.sources ?? sourceCount;
  const read = sourceCount;
  const rounds = stats?.rounds ?? round;
  return `${dur} · ${scanned} scanned · ${read} read · ${rounds} rounds`;
}

/** Render parsed brief HTML and bind action handlers. */
export function renderResearchReportView(
  mount: HTMLElement,
  brief: ParsedBrief,
  statsLine: string,
  actions: ReportViewActions,
  options: ReportViewOptions = {},
): void {
  const savedToLibrary = options.savedToLibrary !== false;
  const findingsHtml = brief.findings.length
    ? brief.findings
        .map((f) => {
          const cites = f.cites
            .map(
              (c) =>
                `<sup class="dr-cite" title="${escapeHtml(brief.sources[c - 1]?.title ?? '')}">${c}</sup>`,
            )
            .join('');
          return `<div class="dr-finding">
            <div class="dr-finding-h">${escapeHtml(f.heading)}</div>
            <p>${escapeHtml(f.body)}${cites}</p>
          </div>`;
        })
        .join('')
    : `<p class="dr-fallback-body">${escapeHtml(brief.tldr)}</p>`;

  const sourcesHtml = brief.sources.length
    ? brief.sources
        .map(
          (s, i) =>
            `<a class="dr-src" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">
              <span class="dr-src-n research-mono">${i + 1}</span>
              <span class="dr-stype research-mono t-${escapeHtml(s.type)}">${escapeHtml(s.type)}</span>
              <span class="dr-src-title">${escapeHtml(s.title)}</span>
              <span class="dr-src-host research-mono">${escapeHtml(s.host)}</span>
              <span class="dr-conf ${s.confidence}">${s.confidence === 'high' ? 'High' : 'Med'}</span>
            </a>`,
        )
        .join('')
    : '<p class="dr-rep-stats">No sources recorded.</p>';

  const followHtml = brief.followups.length
    ? brief.followups
        .map(
          (q) =>
            `<button type="button" class="dr-followchip" data-followup="${escapeHtml(q)}">${escapeHtml(q)} <span aria-hidden="true">→</span></button>`,
        )
        .join('')
    : '';

  mount.innerHTML = `
    <div class="dr-report">
      <div class="dr-rep-top">
        <div class="dr-rep-badge"><span aria-hidden="true">✓</span> Complete</div>
        <div class="dr-rep-stats research-mono">${escapeHtml(statsLine)}</div>
      </div>
      <h1 class="dr-rep-title">${escapeHtml(brief.title)}</h1>
      <div class="dr-tldr">
        <div class="dr-tldr-h research-mono">TL;DR</div>
        <p>${escapeHtml(brief.tldr)}</p>
      </div>
      ${brief.findings.length ? '<h3 class="dr-rep-sec">Key findings</h3>' : ''}
      <div class="dr-findings">${findingsHtml}</div>
      <h3 class="dr-rep-sec">Sources <span class="dr-rep-dim">· ${brief.sources.length}</span></h3>
      <div class="dr-srclist">${sourcesHtml}</div>
      ${followHtml ? '<h3 class="dr-rep-sec">Suggested follow-ups</h3><div class="dr-follow">' + followHtml + '</div>' : ''}
      <div class="dr-rep-actions">
        ${
          savedToLibrary
            ? ''
            : '<button type="button" class="dr-save" id="btnResearchSaved">Save to Library</button>'
        }
        <button type="button" class="dr-ghost" id="btnResearchAddToBrain">Add to Brain</button>
        <button type="button" class="dr-ghost" id="btnResearchExport">Export</button>
        <button type="button" class="dr-ghost" id="btnResearchRunAgain">Run again</button>
        <button type="button" class="dr-ghost" id="btnResearchDiscuss">Discuss</button>
        <button type="button" class="dr-ghost" id="btnResearchRefine">Refine</button>
      </div>
    </div>
  `;

  mount.querySelector('#btnResearchSaved')?.addEventListener('click', (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    btn.classList.add('done');
    btn.innerHTML = '<span aria-hidden="true">✓</span> Saved to Library';
    actions.onViewLibrary();
  });
  // When savedToLibrary is true the Save button is omitted — completed runs are auto-persisted.
  mount.querySelector('#btnResearchAddToBrain')?.addEventListener('click', () => actions.onAddToBrain());
  mount.querySelector('#btnResearchExport')?.addEventListener('click', () => actions.onExport());
  mount.querySelector('#btnResearchRunAgain')?.addEventListener('click', () => actions.onRunAgain());
  mount.querySelector('#btnResearchDiscuss')?.addEventListener('click', () => actions.onDiscuss());
  mount.querySelector('#btnResearchRefine')?.addEventListener('click', () => actions.onRefine());
  mount.querySelectorAll<HTMLButtonElement>('[data-followup]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-followup') ?? '';
      if (q) {
        actions.onFollowUp(q);
      }
    });
  });
}

/** Convenience: parse markdown + render. */
export function renderResearchResultFromMarkdown(
  mount: HTMLElement,
  markdown: string,
  sources: ResearchSource[],
  query: string,
  stats: ResearchStats | undefined,
  round: number,
  actions: ReportViewActions,
  options?: ReportViewOptions,
): void {
  const brief = parseResearchBrief(markdown, sources, query);
  const statsLine = formatStatsLine(stats, sources.length, round);
  renderResearchReportView(mount, brief, statsLine, actions, options);
}
