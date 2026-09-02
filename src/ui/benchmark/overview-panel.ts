import { pickCampaignInsight } from '../../benchmark/aggregates.ts';
import type { ModelAggregate, ModelScoreIndexRow } from '../../benchmark/campaign-types.ts';
import { fetchModelScoreIndex } from '../../benchmark/campaign-persistence.ts';
import { loadRoster } from '../../benchmark/roster.ts';
import { OVERVIEW_COLUMNS } from './copy.ts';
import { animateBarWidth } from './animations.ts';

let liveAggregates: ModelAggregate[] = [];
let runPhase: 'idle' | 'running' | 'done' = 'idle';
let runProgressPct = 0;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTps(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n)} t/s`;
}

function formatTtft(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatQuality(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return `${Math.round(score * 100)}`;
}

function mergeRows(
  index: ModelScoreIndexRow[],
): Array<ModelScoreIndexRow & { fromLive?: ModelAggregate }> {
  const roster = loadRoster();
  const byKey = new Map<string, ModelScoreIndexRow & { fromLive?: ModelAggregate }>();

  for (const row of index) {
    byKey.set(row.targetKey, row);
  }
  for (const agg of liveAggregates) {
    byKey.set(agg.targetKey, {
      targetKey: agg.targetKey,
      providerId: agg.providerId,
      modelId: agg.modelId,
      label: agg.label,
      campaignId: '',
      startedAt: '',
      totalScore: agg.totalScore,
      headlineTokPerSec: agg.headlineTokPerSec,
      headlineTtftMs: agg.headlineTtftMs,
      fromLive: agg,
    });
  }
  for (const target of roster) {
    const key = `${target.providerId}::${target.modelId}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        targetKey: key,
        providerId: target.providerId,
        modelId: target.modelId,
        label: target.label ?? `${target.providerId} / ${target.modelId}`,
        campaignId: '',
        startedAt: '',
        totalScore: 0,
        headlineTokPerSec: 0,
        headlineTtftMs: 0,
      });
    }
  }
  return [...byKey.values()];
}

function renderInsightNote(mount: HTMLElement, aggregates: ModelAggregate[]): void {
  const existing = mount.querySelector('.bench-note');
  existing?.remove();
  if (runPhase !== 'done' || !aggregates.length) return;
  const { fastest, quality } = pickCampaignInsight(aggregates);
  if (!fastest && !quality) return;
  const note = document.createElement('div');
  note.className = 'bench-note';
  note.setAttribute('role', 'status');
  let text = '';
  if (fastest && quality && fastest.targetKey !== quality.targetKey) {
    text = `<b>${escapeHtml(fastest.label)}</b> is fastest; <b>${escapeHtml(quality.label)}</b> scores highest on quality. Pick by task.`;
  } else if (quality) {
    text = `<b>${escapeHtml(quality.label)}</b> leads this run.`;
  }
  note.innerHTML = `<span class="bench-note-ico" aria-hidden="true">✦</span> ${text}`;
  mount.appendChild(note);
}

function renderGrid(mount: HTMLElement, rows: ReturnType<typeof mergeRows>): void {
  const maxTps = Math.max(1, ...rows.map((r) => r.headlineTokPerSec || 0));
  const showValues = runPhase !== 'idle';

  const progHtml =
    runPhase === 'running'
      ? `<div class="bench-prog" role="status"><div class="bench-prog-track"><div class="bench-prog-fill" style="width:${runProgressPct}%"></div></div><span class="bench-prog-label benchmark-mono">${runProgressPct}% · measuring throughput…</span></div>`
      : '';

  const gridRows = rows
    .map((row) => {
      const tpsPct = showValues && row.headlineTokPerSec > 0
        ? (row.headlineTokPerSec / maxTps) * 100
        : 0;
      const qualPct = showValues && row.totalScore > 0 ? row.totalScore * 100 : 0;
      return `<div class="bench-row" data-target-key="${escapeHtml(row.targetKey)}">
        <div class="bench-model"><span class="bench-dot" aria-hidden="true"></span><b>${escapeHtml(row.label)}</b><span class="benchmark-mono benchmark-muted">${escapeHtml(row.modelId)}</span></div>
        <div class="bench-bar"><div class="bar" data-tps-bar style="width:${showValues ? tpsPct : 0}%"></div><span class="benchmark-mono">${showValues ? formatTps(row.headlineTokPerSec) : '—'}</span></div>
        <div class="benchmark-mono bench-ttft">${showValues ? formatTtft(row.headlineTtftMs) : '—'}</div>
        <div class="bench-qual"><div class="qual-track"><div class="qual-fill" data-qual-bar style="width:${showValues ? qualPct : 0}%"></div></div><span class="benchmark-mono">${showValues ? formatQuality(row.totalScore) : '—'}</span></div>
      </div>`;
    })
    .join('');

  mount.innerHTML = `${progHtml}
    <div class="bench-grid">
      <div class="bench-row bench-head"><span>${OVERVIEW_COLUMNS.model}</span><span title="Tokens per second">${OVERVIEW_COLUMNS.tokPerSec}</span><span title="Time to first token">${OVERVIEW_COLUMNS.ttft}</span><span>${OVERVIEW_COLUMNS.quality}</span></div>
      ${gridRows || '<p class="benchmark-empty">Add models on the Run tab, then start a benchmark.</p>'}
    </div>`;

  if (showValues) {
    for (const bar of mount.querySelectorAll<HTMLElement>('[data-tps-bar]')) {
      const w = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => animateBarWidth(bar, parseFloat(w) || 0));
    }
    for (const bar of mount.querySelectorAll<HTMLElement>('[data-qual-bar]')) {
      const w = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => animateBarWidth(bar, parseFloat(w) || 0));
    }
  }

  renderInsightNote(mount, liveAggregates);
}

export async function renderOverviewPanel(mount: HTMLElement): Promise<void> {
  mount.classList.add('benchmark-tab-panel--overview');
  let index: ModelScoreIndexRow[] = [];
  try {
    index = await fetchModelScoreIndex();
  } catch {
    index = [];
  }
  const rows = mergeRows(index);
  renderGrid(mount, rows);
}

export function setOverviewRunState(
  phase: 'idle' | 'running' | 'done',
  progressPct = 0,
): void {
  runPhase = phase;
  runProgressPct = progressPct;
}

export function updateOverviewLiveAggregates(aggregates: ModelAggregate[]): void {
  liveAggregates = aggregates;
}

export function refreshOverviewPanel(): void {
  const mount = document.getElementById('benchmarkTabOverview');
  if (mount) void renderOverviewPanel(mount);
}
