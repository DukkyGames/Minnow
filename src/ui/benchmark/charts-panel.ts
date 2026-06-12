/**
 * Benchmark Charts tab — SVG analytics (no React mount; lazy optional Recharts later).
 */

import type { BenchmarkCampaign, ModelAggregate } from '../../benchmark/campaign-types.ts';
import { loadCampaign, listCampaignSummaries } from '../../benchmark/campaign-persistence.ts';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** Short model id for chart axis labels (provider is omitted). */
function chartModelLabel(aggregate: ModelAggregate): string {
  const name = aggregate.modelId.trim();
  if (!name) return '—';
  if (name.length > 12) return `${name.slice(0, 10)}…`;
  return name;
}

async function loadLatestCampaign(): Promise<BenchmarkCampaign | null> {
  const summaries = await listCampaignSummaries();
  if (!summaries.length) return null;
  return loadCampaign(summaries[0]!.id);
}

function renderGroupedBarSvg(
  campaign: BenchmarkCampaign,
): string {
  const aggregates = campaign.aggregates;
  const maxTps = Math.max(1, ...aggregates.map((a) => a.headlineTokPerSec || 0));
  const maxQual = 100;
  const barW = 28;
  const gap = 48;
  const chartH = 160;
  const baseY = chartH + 24;

  const bars = aggregates
    .map((a, i) => {
      const x = 40 + i * (barW * 2 + gap);
      const tpsH = ((a.headlineTokPerSec || 0) / maxTps) * chartH;
      const qualH = ((a.totalScore || 0) * maxQual / maxQual) * chartH;
      const label = escapeHtml(chartModelLabel(a));
      return `
        <rect x="${x}" y="${baseY - tpsH}" width="${barW}" height="${tpsH}" class="benchmark-chart-bar benchmark-chart-bar--tps" />
        <rect x="${x + barW + 4}" y="${baseY - qualH}" width="${barW}" height="${qualH}" class="benchmark-chart-bar benchmark-chart-bar--qual" />
        <text x="${x + barW}" y="${baseY + 14}" text-anchor="middle" class="benchmark-chart-label">${label}</text>`;
    })
    .join('');

  const width = 40 + aggregates.length * (barW * 2 + gap) + 20;
  return `<svg viewBox="0 0 ${width} ${baseY + 28}" class="benchmark-chart-svg" role="img" aria-label="Throughput and quality by model">
    <text x="0" y="14" class="benchmark-chart-axis-label">tok/s (accent) · quality % (muted)</text>
    ${bars}
  </svg>`;
}

function renderRadarSvg(campaign: BenchmarkCampaign): string {
  const aggregates = campaign.aggregates;
  const cx = 120;
  const cy = 100;
  const r = 70;
  const axes = ['Integration', 'Standard', 'Custom'];
  const values = aggregates.map((a) => [
    a.integrationScore,
    a.standardScore,
    a.customScore,
  ]);

  const axisPoints = axes.map((_, i) => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      label: axes[i],
      lx: cx + (r + 16) * Math.cos(angle),
      ly: cy + (r + 16) * Math.sin(angle),
    };
  });

  const polygons = values
    .map((series, si) => {
      const pts = series
        .map((v, i) => {
          const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
          const dist = r * Math.max(0, Math.min(1, v));
          return `${cx + dist * Math.cos(angle)},${cy + dist * Math.sin(angle)}`;
        })
        .join(' ');
      return `<polygon points="${pts}" class="benchmark-chart-radar benchmark-chart-radar--${si}" />`;
    })
    .join('');

  const axisLines = axisPoints
    .map((p) => `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" class="benchmark-chart-grid-line" />`)
    .join('');
  const labels = axisPoints
    .map(
      (p) =>
        `<text x="${p.lx}" y="${p.ly}" text-anchor="middle" class="benchmark-chart-label">${escapeHtml(p.label ?? '')}</text>`,
    )
    .join('');

  return `<svg viewBox="0 0 240 200" class="benchmark-chart-svg" role="img" aria-label="Suite family radar">
    ${axisLines}
    ${polygons}
    ${labels}
  </svg>`;
}

function renderHistoryLineSvg(campaigns: BenchmarkCampaign[]): string {
  const points: Array<{ x: number; y: number; label: string }> = [];
  const sorted = [...campaigns].sort((a, b) =>
    String(a.startedAt).localeCompare(String(b.startedAt)),
  );
  sorted.forEach((c, i) => {
    const score = c.aggregates[0]?.totalScore ?? 0;
    points.push({ x: 30 + i * 60, y: 140 - score * 120, label: c.startedAt.slice(0, 10) });
  });
  if (points.length < 2) {
    return '<p class="benchmark-empty">Need more campaigns for history line.</p>';
  }
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const dots = points
    .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" class="benchmark-chart-dot" />`)
    .join('');
  return `<svg viewBox="0 0 ${points.length * 60 + 40} 160" class="benchmark-chart-svg" role="img" aria-label="Score over time">
    <path d="${d}" fill="none" class="benchmark-chart-line" stroke-width="2" />
    ${dots}
  </svg>`;
}

/** Render charts when the tab is opened. */
export async function renderChartsPanel(mount: HTMLElement): Promise<void> {
  mount.classList.add('benchmark-tab-panel--charts');
  const campaign = await loadLatestCampaign();

  if (!campaign?.aggregates?.length) {
    mount.innerHTML =
      '<p class="benchmark-empty">Run a campaign to see comparison charts.</p>';
    return;
  }

  const summaries = await listCampaignSummaries();
  const historyCampaigns: BenchmarkCampaign[] = [];
  for (const s of summaries.slice(0, 6)) {
    const c = await loadCampaign(s.id);
    if (c) historyCampaigns.push(c);
  }

  mount.innerHTML = `
    <div class="benchmark-charts-grid">
      <section class="benchmark-chart-card">
        <h3 class="benchmark-chart-title">Throughput &amp; quality</h3>
        ${renderGroupedBarSvg(campaign)}
      </section>
      <section class="benchmark-chart-card">
        <h3 class="benchmark-chart-title">Suite families</h3>
        ${renderRadarSvg(campaign)}
      </section>
      <section class="benchmark-chart-card benchmark-chart-card--wide">
        <h3 class="benchmark-chart-title">Score history</h3>
        ${renderHistoryLineSvg(historyCampaigns)}
      </section>
    </div>`;
}

export function invalidateChartsPanel(): void {
  const mount = document.getElementById('benchmarkTabCharts');
  if (mount) mount.innerHTML = '';
}

export function isChartsMounted(): boolean {
  return Boolean(document.getElementById('benchmarkTabCharts')?.querySelector('.benchmark-charts-grid'));
}
