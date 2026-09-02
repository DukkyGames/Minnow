import { computeCampaignAggregates, pickCampaignInsight } from '../../benchmark/aggregates.ts';
import type {
  BenchmarkCampaign,
  BenchmarkCampaignSummary,
  BenchmarkCellResult,
  ModelAggregate,
} from '../../benchmark/campaign-types.ts';
import { listCampaignSummaries, loadCampaign } from '../../benchmark/campaign-persistence.ts';
import { catalogFamilyLabel } from './copy.ts';
import { animateBarWidth, barTransitionMs } from './animations.ts';

/** Distinct series colors for up to eight models (OKLCH, metric-safe hues). */
const MODEL_SERIES_COLORS = [
  'oklch(0.28 0.02 250)',
  'oklch(0.62 0.14 155)',
  'oklch(0.55 0.12 250)',
  'oklch(0.65 0.14 45)',
  'oklch(0.58 0.10 300)',
  'oklch(0.52 0.11 200)',
  'oklch(0.68 0.12 85)',
  'oklch(0.48 0.08 280)',
] as const;

type HistoricalBest = {
  targetKey: string;
  label: string;
  modelId: string;
  bestScore: number;
  bestAt: string;
  campaignId: string;
};

type HistorySeries = {
  targetKey: string;
  label: string;
  color: string;
  points: Array<{ x: number; y: number; date: string; score: number }>;
};

type TestGroup = {
  key: string;
  label: string;
  family: BenchmarkCellResult['family'];
  byModel: Map<string, number>;
};

type ModelDelta = {
  score: number | null;
  tokPerSec: number | null;
};

type TestInsight = {
  group: TestGroup;
  averageScore: number;
  spread: number;
  best: { aggregate: ModelAggregate; score: number };
  weakest: { aggregate: ModelAggregate; score: number };
};

let selectedCampaignId: string | null = null;
let hiddenModels = new Set<string>();
let cachedCampaigns: BenchmarkCampaign[] = [];
let cachedSummaries: BenchmarkCampaignSummary[] = [];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return `${Math.round(score * 100)}`;
}

function formatTps(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n)}`;
}

function formatSignedScoreDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return 'new';
  const pct = Math.round(delta * 100);
  if (pct === 0) return '±0';
  return `${pct > 0 ? '+' : ''}${pct}`;
}

function formatSignedTpsDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return 'new';
  const rounded = Math.round(delta);
  if (rounded === 0) return '±0';
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

/** Semantic class for signed delta chips. */
function deltaClass(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return '';
  if (delta > 0) return 'is-up';
  if (delta < 0) return 'is-down';
  return '';
}

function hasPriorRunDeltas(deltas: Map<string, ModelDelta>): boolean {
  for (const row of deltas.values()) {
    if (row.score !== null || row.tokPerSec !== null) return true;
  }
  return false;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatShortDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(5, 10);
  }
}

function modelColor(index: number): string {
  return MODEL_SERIES_COLORS[index % MODEL_SERIES_COLORS.length]!;
}

function clamp01(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function aggregateList(campaign: BenchmarkCampaign): ModelAggregate[] {
  return campaign.aggregates?.length > 0
    ? campaign.aggregates
    : computeCampaignAggregates(campaign);
}

function visibleAggregates(campaign: BenchmarkCampaign): ModelAggregate[] {
  const aggregates = aggregateList(campaign);
  return aggregates.filter((a) => !hiddenModels.has(a.targetKey));
}

async function loadAllCampaigns(summaries: BenchmarkCampaignSummary[]): Promise<BenchmarkCampaign[]> {
  const campaigns: BenchmarkCampaign[] = [];
  for (const summary of summaries) {
    const campaign = await loadCampaign(summary.id);
    if (campaign) campaigns.push(campaign);
  }
  return campaigns;
}

/** Track the highest quality score each model has ever achieved. */
function buildHistoricalBest(campaigns: BenchmarkCampaign[]): HistoricalBest[] {
  const byKey = new Map<string, HistoricalBest>();
  const sorted = [...campaigns].sort((a, b) =>
    String(a.startedAt).localeCompare(String(b.startedAt)),
  );

  for (const campaign of sorted) {
    const aggregates = aggregateList(campaign);
    for (const agg of aggregates) {
      const existing = byKey.get(agg.targetKey);
      if (!existing || agg.totalScore > existing.bestScore) {
        byKey.set(agg.targetKey, {
          targetKey: agg.targetKey,
          label: agg.label,
          modelId: agg.modelId,
          bestScore: agg.totalScore,
          bestAt: campaign.startedAt,
          campaignId: campaign.id,
        });
      }
    }
  }

  return [...byKey.values()].sort((a, b) => b.bestScore - a.bestScore);
}

/** Group scored cells by test for per-test comparison bars. */
function groupTestsByLabel(campaign: BenchmarkCampaign): TestGroup[] {
  const groups = new Map<string, TestGroup>();
  for (const cell of campaign.cells) {
    if (cell.skipped) continue;
    const key = `${cell.family}::${cell.testId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: cell.label || cell.testId,
        family: cell.family,
        byModel: new Map(),
      };
      groups.set(key, group);
    }
    group.byModel.set(cell.targetKey, cell.score);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Compare the selected run with the closest earlier saved run. */
function buildPreviousDeltaMap(
  campaigns: BenchmarkCampaign[],
  selectedCampaign: BenchmarkCampaign,
): Map<string, ModelDelta> {
  const sorted = [...campaigns].sort((a, b) =>
    String(a.startedAt).localeCompare(String(b.startedAt)),
  );
  const selectedIndex = sorted.findIndex((c) => c.id === selectedCampaign.id);
  if (selectedIndex <= 0) return new Map();

  const previous = sorted[selectedIndex - 1]!;
  const previousByKey = new Map(aggregateList(previous).map((a) => [a.targetKey, a]));
  const deltas = new Map<string, ModelDelta>();
  for (const aggregate of aggregateList(selectedCampaign)) {
    const before = previousByKey.get(aggregate.targetKey);
    deltas.set(aggregate.targetKey, {
      score: before ? aggregate.totalScore - before.totalScore : null,
      tokPerSec: before ? aggregate.headlineTokPerSec - before.headlineTokPerSec : null,
    });
  }
  return deltas;
}

function buildTestInsights(
  campaign: BenchmarkCampaign,
  aggregates: ModelAggregate[],
): TestInsight[] {
  const tests = groupTestsByLabel(campaign);
  return tests
    .map((group): TestInsight | null => {
      const scored = aggregates
        .map((aggregate) => ({
          aggregate,
          score: clamp01(group.byModel.get(aggregate.targetKey) ?? 0),
        }))
        .sort((a, b) => b.score - a.score);
      if (!scored.length) return null;

      const scores = scored.map((row) => row.score);
      const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      return {
        group,
        averageScore,
        spread: scored[0]!.score - scored[scored.length - 1]!.score,
        best: scored[0]!,
        weakest: scored[scored.length - 1]!,
      };
    })
    .filter((insight): insight is TestInsight => Boolean(insight))
    .sort((a, b) => {
      const averageDiff = a.averageScore - b.averageScore;
      if (Math.abs(averageDiff) > 0.001) return averageDiff;
      return b.spread - a.spread;
    });
}

function renderToolbar(
  summaries: BenchmarkCampaignSummary[],
  aggregates: ModelAggregate[],
): string {
  const options = summaries
    .map((s) => {
      const selected = s.id === selectedCampaignId ? ' selected' : '';
      const date = formatDate(s.startedAt);
      const models = `${s.targetCount} model${s.targetCount === 1 ? '' : 's'}`;
      return `<option value="${escapeHtml(s.id)}"${selected}>${escapeHtml(date)} · ${escapeHtml(models)} · ${escapeHtml(s.preset)}</option>`;
    })
    .join('');

  const toggles = aggregates
    .map((agg, i) => {
      const hidden = hiddenModels.has(agg.targetKey);
      const color = modelColor(i);
      return `<button type="button" class="charts-model-toggle${hidden ? '' : ' is-on'}" data-target-key="${escapeHtml(agg.targetKey)}" aria-pressed="${hidden ? 'false' : 'true'}">
        <span class="charts-swatch" style="background:${color}" aria-hidden="true"></span>
        <span class="charts-model-toggle-label">${escapeHtml(agg.label)}</span>
      </button>`;
    })
    .join('');

  return `<header class="charts-toolbar">
    <div class="charts-toolbar-group">
      <label class="charts-field">
        <span class="charts-field-label">Run</span>
        <select id="chartsCampaignSelect" class="charts-select">${options}</select>
      </label>
    </div>
    <div class="charts-toolbar-group charts-toolbar-group--models">
      <span class="charts-field-label">Models</span>
      <div class="charts-model-toggles" role="group" aria-label="Toggle models on charts">${toggles}</div>
    </div>
  </header>`;
}

function renderDecisionSummary(
  campaign: BenchmarkCampaign,
  aggregates: ModelAggregate[],
  deltas: Map<string, ModelDelta>,
): string {
  if (!aggregates.length) {
    return '<section class="charts-section"><p class="benchmark-empty">Enable at least one model to compare.</p></section>';
  }

  const { fastest, quality } = pickCampaignInsight(aggregates);
  const vsPrior = hasPriorRunDeltas(deltas);
  const hint = vsPrior
    ? `${escapeHtml(formatDate(campaign.startedAt))} · deltas vs previous run`
    : escapeHtml(formatDate(campaign.startedAt));

  if (aggregates.length === 1 && quality) {
    const row = deltas.get(quality.targetKey);
    const scoreDelta = formatSignedScoreDelta(row?.score ?? null);
    return `<section class="charts-section charts-section--brief" aria-labelledby="chartsBriefTitle">
      <div class="charts-block-hdr">
        <h3 id="chartsBriefTitle" class="charts-block-title">Summary</h3>
        <p class="charts-block-hint">${hint}</p>
      </div>
      <p class="charts-brief-line benchmark-mono">
        <span>${formatScore(quality.totalScore)}% quality</span>
        <span>${formatTps(quality.headlineTokPerSec)} tok/s</span>
        ${vsPrior ? `<span class="charts-delta ${deltaClass(row?.score ?? null)}">${escapeHtml(scoreDelta)} pts</span>` : ''}
      </p>
    </section>`;
  }

  const maxTps = Math.max(1, ...aggregates.map((a) => a.headlineTokPerSec || 0));
  const balanced = [...aggregates].sort((a, b) => {
    const aScore = a.totalScore * 0.72 + (a.headlineTokPerSec / maxTps) * 0.28;
    const bScore = b.totalScore * 0.72 + (b.headlineTokPerSec / maxTps) * 0.28;
    return bScore - aScore;
  })[0]!;

  const picks = [
    { label: 'Best quality', aggregate: quality, value: quality ? `${formatScore(quality.totalScore)}%` : '—', delta: deltas.get(quality?.targetKey ?? '')?.score ?? null },
    { label: 'Fastest', aggregate: fastest, value: fastest ? `${formatTps(fastest.headlineTokPerSec)} tok/s` : '—', delta: deltas.get(fastest?.targetKey ?? '')?.tokPerSec ?? null, deltaSuffix: ' tok/s', formatDelta: formatSignedTpsDelta },
    { label: 'Balanced', aggregate: balanced, value: `${formatScore(balanced.totalScore)}%`, delta: deltas.get(balanced.targetKey)?.score ?? null },
  ];

  const pickMarkup = picks
    .map((pick) => {
      const formatDelta = pick.formatDelta ?? formatSignedScoreDelta;
      const suffix = pick.deltaSuffix ?? ' pts';
      const deltaText = vsPrior ? `${formatDelta(pick.delta)}${suffix}` : '';
      return `<div class="charts-pick">
        <span class="charts-pick-label">${escapeHtml(pick.label)}</span>
        <span class="charts-pick-model">${pick.aggregate ? escapeHtml(pick.aggregate.label) : '—'}</span>
        <span class="charts-pick-value benchmark-mono">${escapeHtml(pick.value)}</span>
        ${deltaText ? `<span class="charts-delta ${deltaClass(pick.delta)}">${escapeHtml(deltaText)}</span>` : ''}
      </div>`;
    })
    .join('');

  const ranking = [...aggregates]
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((aggregate, i) => {
      const delta = deltas.get(aggregate.targetKey);
      const color = modelColor(aggregates.findIndex((a) => a.targetKey === aggregate.targetKey));
      return `<li class="charts-rank-row">
        <span class="benchmark-mono charts-rank">${i + 1}</span>
        <span class="charts-swatch" style="background:${color}" aria-hidden="true"></span>
        <span class="charts-rank-model">${escapeHtml(aggregate.label)}</span>
        <span class="benchmark-mono">${formatScore(aggregate.totalScore)}%</span>
        <span class="benchmark-mono charts-rank-speed">${formatTps(aggregate.headlineTokPerSec)} tok/s</span>
        ${vsPrior ? `<span class="charts-delta ${deltaClass(delta?.score ?? null)}">${escapeHtml(formatSignedScoreDelta(delta?.score ?? null))}</span>` : ''}
      </li>`;
    })
    .join('');

  return `<section class="charts-section charts-section--brief" aria-labelledby="chartsBriefTitle">
    <div class="charts-block-hdr">
      <h3 id="chartsBriefTitle" class="charts-block-title">Summary</h3>
      <p class="charts-block-hint">${hint}</p>
    </div>
    <div class="charts-picks">${pickMarkup}</div>
    <ol class="charts-rank-list">${ranking}</ol>
  </section>`;
}

function renderLeaderboard(best: HistoricalBest[], colorByKey: Map<string, string>): string {
  if (!best.length) {
    return '<p class="benchmark-empty">No historical scores yet.</p>';
  }

  const rows = best
    .slice(0, 6)
    .map((row, rank) => {
      const color = colorByKey.get(row.targetKey) ?? modelColor(rank);
      const medal = rank === 0 ? ' charts-rank--gold' : rank === 1 ? ' charts-rank--silver' : rank === 2 ? ' charts-rank--bronze' : '';
      return `<li class="charts-leader-row">
        <span class="charts-rank${medal} benchmark-mono">${rank + 1}</span>
        <span class="charts-swatch" style="background:${color}" aria-hidden="true"></span>
        <span class="charts-leader-model"><b>${escapeHtml(row.label)}</b><span class="benchmark-mono benchmark-muted">${escapeHtml(row.modelId)}</span></span>
        <span class="charts-leader-score benchmark-mono">${formatScore(row.bestScore)}</span>
        <span class="charts-leader-date benchmark-mono benchmark-muted">${escapeHtml(formatDate(row.bestAt))}</span>
      </li>`;
    })
    .join('');

  return `<section class="charts-section" aria-labelledby="chartsLeaderTitle">
    <div class="charts-block-hdr">
      <h3 id="chartsLeaderTitle" class="charts-block-title">All-time best</h3>
      <p class="charts-block-hint">Highest score each model has reached.</p>
    </div>
    <ol class="charts-leader-list">${rows}</ol>
  </section>`;
}

function renderComparisonGrid(campaign: BenchmarkCampaign, aggregates: ModelAggregate[]): string {
  if (!aggregates.length) {
    return '<p class="benchmark-empty">Enable at least one model to compare.</p>';
  }

  const maxTps = Math.max(1, ...aggregates.map((a) => a.headlineTokPerSec || 0));
  const { fastest, quality } = pickCampaignInsight(aggregates);

  const rows = aggregates
    .map((agg, i) => {
      const color = modelColor(i);
      const tpsPct = agg.headlineTokPerSec > 0 ? (agg.headlineTokPerSec / maxTps) * 100 : 0;
      const qualPct = agg.totalScore > 0 ? agg.totalScore * 100 : 0;
      const isFastest = aggregates.length > 1 && fastest?.targetKey === agg.targetKey;
      const isBest = aggregates.length > 1 && quality?.targetKey === agg.targetKey;
      const badges = [
        isFastest ? '<span class="charts-badge charts-badge--speed">Fastest</span>' : '',
        isBest ? '<span class="charts-badge charts-badge--quality">Top score</span>' : '',
      ].join('');

      return `<div class="charts-compare-row" data-target-key="${escapeHtml(agg.targetKey)}">
        <div class="charts-compare-model">
          <span class="charts-swatch" style="background:${color}" aria-hidden="true"></span>
          <div class="charts-compare-names">
            <b>${escapeHtml(agg.label)}</b>
            ${aggregates.length > 1 ? `<span class="benchmark-mono benchmark-muted">${escapeHtml(agg.modelId)}</span>` : ''}
            ${badges ? `<span class="charts-badges">${badges}</span>` : ''}
          </div>
        </div>
        <div class="charts-metric">
          <div class="charts-metric-track"><div class="charts-metric-fill charts-metric-fill--speed" data-bar style="width:0%;--series-color:${color}" data-target-width="${tpsPct}"></div></div>
          <span class="benchmark-mono">${formatTps(agg.headlineTokPerSec)} <span class="benchmark-muted">tok/s</span></span>
        </div>
        <div class="charts-metric">
          <div class="charts-metric-track"><div class="charts-metric-fill charts-metric-fill--quality" data-bar style="width:0%;--series-color:${color}" data-target-width="${qualPct}"></div></div>
          <span class="benchmark-mono">${formatScore(agg.totalScore)} <span class="benchmark-muted">%</span></span>
        </div>
      </div>`;
    })
    .join('');

  return `<section class="charts-section" aria-labelledby="chartsCompareTitle">
    <div class="charts-block-hdr">
      <h3 id="chartsCompareTitle" class="charts-block-title">This run</h3>
      <p class="charts-block-hint">${aggregates.length} model${aggregates.length === 1 ? '' : 's'}</p>
    </div>
    <div class="charts-compare-grid">
      <div class="charts-compare-row charts-compare-head">
        <span>Model</span><span>Throughput</span><span>Quality</span>
      </div>
      ${rows}
    </div>
  </section>`;
}

function renderFamilyScores(aggregates: ModelAggregate[]): string {
  if (!aggregates.length) return '';

  const families: Array<{ key: keyof ModelAggregate; label: string }> = [
    { key: 'integrationScore', label: 'Minnow tests' },
    { key: 'standardScore', label: 'Academic' },
    { key: 'customScore', label: 'Custom' },
  ];

  const rows = families
    .map((family) => {
      const cells = aggregates
        .map((agg, i) => {
          const score = agg[family.key];
          const pct = typeof score === 'number' && score > 0 ? score * 100 : 0;
          const color = modelColor(i);
          return `<div class="charts-family-cell" title="${escapeHtml(agg.label)}: ${formatScore(typeof score === 'number' ? score : 0)}%">
            <div class="charts-family-bar-track"><div class="charts-family-bar" data-bar style="width:0%;background:${color}" data-target-width="${pct}"></div></div>
            <span class="benchmark-mono charts-family-val">${formatScore(typeof score === 'number' ? score : 0)}</span>
          </div>`;
        })
        .join('');
      return `<div class="charts-family-row">
        <span class="charts-family-label">${escapeHtml(family.label)}</span>
        <div class="charts-family-cells">${cells}</div>
      </div>`;
    })
    .join('');

  const legend =
    aggregates.length > 1
      ? aggregates
          .map((agg, i) => {
            const color = modelColor(i);
            return `<span class="charts-legend-item"><span class="charts-swatch" style="background:${color}" aria-hidden="true"></span>${escapeHtml(agg.label)}</span>`;
          })
          .join('')
      : '';

  return `<section class="charts-section" aria-labelledby="chartsFamilyTitle">
    <div class="charts-block-hdr">
      <h3 id="chartsFamilyTitle" class="charts-block-title">Test families</h3>
      <p class="charts-block-hint">Mean score per suite family.</p>
    </div>
    ${legend ? `<div class="charts-family-legend">${legend}</div>` : ''}
    <div class="charts-family-grid">${rows}</div>
  </section>`;
}

function renderTestInsights(
  campaign: BenchmarkCampaign,
  aggregates: ModelAggregate[],
): string {
  const insights = buildTestInsights(campaign, aggregates);
  if (!insights.length) {
    return `<section class="charts-section charts-section--wide" aria-labelledby="chartsTestsTitle">
      <div class="charts-block-hdr">
        <h3 id="chartsTestsTitle" class="charts-block-title">Weak spots</h3>
        <p class="charts-block-hint">Lowest scoring probes for the selected models.</p>
      </div>
      <p class="benchmark-empty">This run has no scored test cells yet.</p>
    </section>`;
  }

  const multiModel = aggregates.length > 1;
  const keyToIndex = new Map(aggregates.map((a, i) => [a.targetKey, i]));

  const rows = insights
    .slice(0, 12)
    .map((insight) => {
      const evidence = multiModel
        ? aggregates
            .map((agg) => {
              const score = clamp01(insight.group.byModel.get(agg.targetKey) ?? 0);
              const pct = score * 100;
              const color = modelColor(keyToIndex.get(agg.targetKey) ?? 0);
              return `<div class="charts-test-evidence" title="${escapeHtml(agg.label)}: ${formatScore(score)}%">
            <span class="charts-swatch" style="background:${color}" aria-hidden="true"></span>
            <div class="charts-test-evidence-track"><div class="charts-test-evidence-bar" data-bar style="width:0%;background:${color}" data-target-width="${pct}"></div></div>
            <span class="benchmark-mono">${formatScore(score)}</span>
          </div>`;
            })
            .join('')
        : '';

      const spreadNote =
        multiModel && insight.spread > 0
          ? `<span class="charts-test-spread benchmark-mono">${formatScore(insight.spread)} pt spread</span>`
          : '';

      return `<div class="charts-test-row${multiModel ? '' : ' charts-test-row--solo'}">
        <div class="charts-test-meta">
          <span class="benchmark-catalog-badge">${escapeHtml(catalogFamilyLabel(insight.group.family))}</span>
          <span class="charts-test-label">${escapeHtml(insight.group.label)}</span>
        </div>
        <span class="benchmark-mono charts-test-score">${formatScore(insight.averageScore)}%</span>
        ${spreadNote}
        ${evidence ? `<div class="charts-test-bars">${evidence}</div>` : ''}
      </div>`;
    })
    .join('');

  return `<section class="charts-section charts-section--wide" aria-labelledby="chartsTestsTitle">
    <div class="charts-block-hdr">
      <h3 id="chartsTestsTitle" class="charts-block-title">Weak spots</h3>
      <p class="charts-block-hint">Lowest average scores first.</p>
    </div>
    <div class="charts-test-list">${rows}</div>
  </section>`;
}

function buildHistorySeries(
  campaigns: BenchmarkCampaign[],
  aggregates: ModelAggregate[],
): HistorySeries[] {
  const sorted = [...campaigns].sort((a, b) =>
    String(a.startedAt).localeCompare(String(b.startedAt)),
  );
  const indexByKey = new Map(aggregates.map((a, i) => [a.targetKey, i]));

  return aggregates.map((agg) => {
    const points: HistorySeries['points'] = [];
    sorted.forEach((campaign, ci) => {
      const campaignAggs = aggregateList(campaign);
      const match = campaignAggs.find((a) => a.targetKey === agg.targetKey);
      if (!match) return;
      const score = match.totalScore;
      points.push({
        x: ci,
        y: score,
        date: campaign.startedAt,
        score,
      });
    });
    return {
      targetKey: agg.targetKey,
      label: agg.label,
      color: modelColor(indexByKey.get(agg.targetKey) ?? 0),
      points,
    };
  });
}

function renderHistoryXLabels(
  sorted: BenchmarkCampaign[],
  padL: number,
  plotW: number,
  xStep: number,
  height: number,
): string {
  const maxLabels = 6;
  const labelEvery = sorted.length <= maxLabels ? 1 : Math.ceil(sorted.length / maxLabels);
  const sameDay = new Set(sorted.map((c) => formatShortDate(c.startedAt))).size < sorted.length / 2;

  return sorted
    .map((c, i) => {
      if (i % labelEvery !== 0 && i !== sorted.length - 1) return '';
      const x = padL + (sorted.length > 1 ? i * xStep : plotW / 2);
      const label = sameDay ? `#${i + 1}` : formatShortDate(c.startedAt);
      return `<text x="${x}" y="${height - 8}" text-anchor="middle" class="charts-axis-label">${escapeHtml(label)}</text>`;
    })
    .join('');
}

function renderHistoryChart(campaigns: BenchmarkCampaign[], aggregates: ModelAggregate[]): string {
  const series = buildHistorySeries(campaigns, aggregates).filter((s) => s.points.length >= 1);
  if (series.length === 0 || campaigns.length < 1) {
    return `<section class="charts-section charts-section--wide" aria-labelledby="chartsHistoryTitle">
      <div class="charts-block-hdr">
        <h3 id="chartsHistoryTitle" class="charts-block-title">Score over runs</h3>
      </div>
      <p class="benchmark-empty">Run at least one benchmark to plot history.</p>
    </section>`;
  }

  const sorted = [...campaigns].sort((a, b) =>
    String(a.startedAt).localeCompare(String(b.startedAt)),
  );

  const padL = 44;
  const padR = 16;
  const padT = 20;
  const padB = 36;
  const plotW = Math.max(280, sorted.length * 72);
  const plotH = 180;
  const width = padL + plotW + padR;
  const height = padT + plotH + padB;
  const baseY = padT + plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const gridLines = yTicks
    .map((t) => {
      const y = padT + plotH * (1 - t);
      return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" class="charts-grid-line" />
        <text x="${padL - 8}" y="${y + 4}" text-anchor="end" class="charts-axis-label benchmark-mono">${Math.round(t * 100)}</text>`;
    })
    .join('');

  const xStep = sorted.length > 1 ? plotW / (sorted.length - 1) : plotW / 2;
  const xLabels = renderHistoryXLabels(sorted, padL, plotW, xStep, height);

  const paths = series
    .map((s) => {
      if (s.points.length < 1) return '';
      const pts = s.points.map((p) => {
        const x = padL + p.x * xStep;
        const y = padT + plotH * (1 - Math.max(0, Math.min(1, p.y)));
        return { ...p, x, y };
      });
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
      const dots = pts
        .map(
          (p) =>
            `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${s.color}" class="charts-history-dot"><title>${escapeHtml(s.label)} · ${formatScore(p.score)}% · ${escapeHtml(formatDate(p.date))}</title></circle>`,
        )
        .join('');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" class="charts-history-line" />${dots}`;
    })
    .join('');

  const multiModel = series.length > 1;
  const legend = multiModel
    ? series
        .map(
          (s) =>
            `<span class="charts-legend-item"><span class="charts-swatch" style="background:${s.color}" aria-hidden="true"></span>${escapeHtml(s.label)}</span>`,
        )
        .join('')
    : '';

  const latestInline = series
    .map((s) => {
      const last = s.points[s.points.length - 1];
      const previous = s.points[s.points.length - 2];
      if (!last) return '';
      const delta = previous ? last.score - previous.score : null;
      const label = multiModel ? `<span class="benchmark-muted">${escapeHtml(s.label)}:</span> ` : '';
      return `${label}<span class="benchmark-mono">${formatScore(last.score)}%</span> <span class="charts-delta ${deltaClass(delta)}">${escapeHtml(formatSignedScoreDelta(delta))}</span>`;
    })
    .join(' · ');

  const axisNote = sorted.length > 6 && new Set(sorted.map((c) => formatShortDate(c.startedAt))).size < sorted.length / 2
    ? ' · run index on axis'
    : '';

  return `<section class="charts-section charts-section--wide" aria-labelledby="chartsHistoryTitle">
    <div class="charts-block-hdr">
      <h3 id="chartsHistoryTitle" class="charts-block-title">Score over runs</h3>
      <p class="charts-block-hint charts-history-hint">${latestInline} · ${sorted.length} saved run${sorted.length === 1 ? '' : 's'}${axisNote}</p>
    </div>
    ${legend ? `<div class="charts-family-legend">${legend}</div>` : ''}
    <svg viewBox="0 0 ${width} ${height}" class="charts-history-svg" role="img" aria-label="Quality score history by model">
      ${gridLines}
      <line x1="${padL}" y1="${baseY}" x2="${padL + plotW}" y2="${baseY}" class="charts-grid-line charts-grid-line--axis" />
      ${paths}
      ${xLabels}
    </svg>
  </section>`;
}

function animateBars(mount: HTMLElement): void {
  for (const bar of mount.querySelectorAll<HTMLElement>('[data-bar]')) {
    const target = parseFloat(bar.dataset.targetWidth ?? '0') || 0;
    animateBarWidth(bar, target);
  }
  const duration = barTransitionMs();
  for (const bar of mount.querySelectorAll<HTMLElement>('[data-vbar]')) {
    const target = parseFloat(bar.dataset.targetHeight ?? '0') || 0;
    if (duration <= 0) {
      bar.style.height = `${target}%`;
      continue;
    }
    bar.style.height = '0%';
    requestAnimationFrame(() => {
      bar.style.transition = `height ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`;
      bar.style.height = `${target}%`;
    });
  }
}

function wireChartsInteractions(mount: HTMLElement): void {
  const select = mount.querySelector<HTMLSelectElement>('#chartsCampaignSelect');
  select?.addEventListener('change', () => {
    selectedCampaignId = select.value;
    void renderChartsPanel(mount);
  });

  for (const btn of mount.querySelectorAll<HTMLButtonElement>('.charts-model-toggle')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.targetKey;
      if (!key) return;
      if (hiddenModels.has(key)) hiddenModels.delete(key);
      else hiddenModels.add(key);
      void renderChartsPanel(mount);
    });
  }
}

function buildColorMap(aggregates: ModelAggregate[]): Map<string, string> {
  return new Map(aggregates.map((a, i) => [a.targetKey, modelColor(i)]));
}

/** Render charts when the tab is opened. */
export async function renderChartsPanel(mount: HTMLElement): Promise<void> {
  mount.classList.add('benchmark-tab-panel--charts');

  cachedSummaries = await listCampaignSummaries();
  if (!cachedSummaries.length) {
    mount.innerHTML =
      '<p class="benchmark-empty">Run a benchmark to see comparison charts.</p>';
    return;
  }

  if (!selectedCampaignId || !cachedSummaries.some((s) => s.id === selectedCampaignId)) {
    selectedCampaignId = cachedSummaries[0]!.id;
  }

  cachedCampaigns = await loadAllCampaigns(cachedSummaries);
  const campaign = cachedCampaigns.find((c) => c.id === selectedCampaignId) ?? cachedCampaigns[0]!;

  const allAggregates =
    campaign.aggregates?.length > 0
      ? campaign.aggregates
      : computeCampaignAggregates(campaign);

  if (!allAggregates.length) {
    mount.innerHTML =
      '<p class="benchmark-empty">Run a benchmark to see comparison charts.</p>';
    return;
  }

  const visible = visibleAggregates(campaign);
  const colorByKey = buildColorMap(allAggregates);
  const historicalBest = buildHistoricalBest(cachedCampaigns);
  const deltas = buildPreviousDeltaMap(cachedCampaigns, campaign);

  mount.innerHTML = `<div class="charts-shell">
    ${renderToolbar(cachedSummaries, allAggregates)}
    ${renderDecisionSummary(campaign, visible, deltas)}
    <div class="charts-layout">
      ${renderComparisonGrid(campaign, visible)}
      ${renderFamilyScores(visible)}
      ${renderTestInsights(campaign, visible)}
      ${renderHistoryChart(cachedCampaigns, visible)}
      ${renderLeaderboard(historicalBest, colorByKey)}
    </div>
  </div>`;

  wireChartsInteractions(mount);
  animateBars(mount);
}

export function invalidateChartsPanel(): void {
  selectedCampaignId = null;
  hiddenModels = new Set();
  cachedCampaigns = [];
  cachedSummaries = [];
  const mount = document.getElementById('benchmarkTabCharts');
  if (mount) mount.innerHTML = '';
}

export function isChartsMounted(): boolean {
  return Boolean(document.getElementById('benchmarkTabCharts')?.querySelector('.charts-shell'));
}
