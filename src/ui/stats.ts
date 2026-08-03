import { STATS_STRIP_OPEN_KEY } from '../constants';
import { getArchiveDisabledReason } from '../chat/archive/index';
import { getActiveChat } from '../state/sessions';
import { formatUsd } from '../usage/token-ledger';
import type { LastStats, ModelInfo, Stats, Usage } from '../types';

export function buildLastStatsSnapshot(stats: Stats | undefined, usage: Usage | undefined): LastStats {
  const s = stats || {};
  const u = usage || {};
  return {
    tokens_per_second: s.tokens_per_second != null ? s.tokens_per_second : null,
    time_to_first_token: s.time_to_first_token != null ? s.time_to_first_token : null,
    generation_time: s.generation_time != null ? s.generation_time : null,
    stop_reason: s.stop_reason != null ? s.stop_reason : null,
    total_tokens: u.total_tokens != null ? u.total_tokens : null,
    prompt_tokens: u.prompt_tokens != null ? u.prompt_tokens : null,
    completion_tokens: u.completion_tokens != null ? u.completion_tokens : null,
  };
}

/** Whether the bottom metrics strip is visible (not fully collapsed). */
export function isStatsStripOpen(): boolean {
  const strip = document.getElementById('statsStrip');
  return strip ? !strip.classList.contains('is-collapsed') : false;
}

/** Show or hide the entire metrics strip; syncs the top-bar toggle. */
export function setStatsStripOpen(open: boolean): void {
  const strip = document.getElementById('statsStrip');
  const topBtn = document.getElementById('btnStats');
  if (!strip) return;

  const wasOpen = isStatsStripOpen();
  strip.classList.toggle('is-collapsed', !open);
  topBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');

  if (!open) {
    strip.classList.remove('is-expanded');
    const expandBtn = document.getElementById('statsExpandBtn');
    expandBtn?.setAttribute('aria-expanded', 'false');
  }

  if (wasOpen !== open) {
    try {
      localStorage.setItem(STATS_STRIP_OPEN_KEY, open ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
  }
}

export function openStatsStrip(): void {
  setStatsStripOpen(true);
}

export function closeStatsStrip(): void {
  setStatsStripOpen(false);
}

export function toggleStatsStrip(): void {
  setStatsStripOpen(!isStatsStripOpen());
}

/** Wire top-bar metrics button and restore last open/closed preference. */
export function initStatsStrip(): void {
  let open = false;
  try {
    open = localStorage.getItem(STATS_STRIP_OPEN_KEY) === '1';
  } catch {
    open = false;
  }
  setStatsStripOpen(open);
  document.getElementById('btnStats')?.addEventListener('click', () => {
    toggleStatsStrip();
  });
}

/** Expand or collapse the detailed metrics panel inside an open strip. */
export function toggleStatsPanel(): void {
  const strip = document.getElementById('statsStrip')!;
  if (strip.classList.contains('is-collapsed')) {
    setStatsStripOpen(true);
  }
  const btn = document.getElementById('statsExpandBtn')!;
  const expanded = strip.classList.toggle('is-expanded');
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

/** Collapse expanded metrics when the file viewer split is active (narrow chat column). */
export function collapseStatsPanelForSplit(): void {
  const strip = document.getElementById('statsStrip');
  const btn = document.getElementById('statsExpandBtn');
  if (!strip) return;
  strip.classList.remove('is-expanded');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  updateStatsExpandPreview();
}

/** Reset stats expand state when the workspace split opens or closes. */
export function syncStatsStripLayoutForViewer(viewerOpen: boolean): void {
  if (viewerOpen) collapseStatsPanelForSplit();
}

export function updateStatsExpandPreview(): void {
  const preview = document.getElementById('statsExpandPreview');
  if (!preview) return;
  const tpsEl = document.getElementById('stripTPS');
  const totalEl = document.getElementById('stripTotal');
  if (!tpsEl || !totalEl) return;
  const tps = tpsEl.textContent?.trim() ?? '';
  const total = totalEl.textContent?.trim() ?? '';
  const trim = getActiveChat().lastContextTrim;
  const archiveChip =
    trim?.archived != null && trim.archived > 0
      ? ` · archive: ${trim.archived}→${trim.recalled ?? 0}`
      : '';
  const archiveDisabled = getArchiveDisabledReason();
  const disabledChip = archiveDisabled ? ` · archive: disabled — ${archiveDisabled}` : '';
  preview.textContent = `${tps} t/s · ${total} tokens${archiveChip}${disabledChip}`;
}

export interface UpdateStripOptions {
  /** Override cost chip (e.g. board-wide rollup). */
  costUsd?: number | null;
}

/** Refresh bottom metrics strip and token bars from latest turn data. */
export function updateStrip(
  stats: Stats | undefined,
  usage: Usage | undefined,
  modelInfo: ModelInfo | undefined,
  options?: UpdateStripOptions,
): void {
  const s = stats || {};
  const u = usage || {};
  const m = modelInfo || {};

  function set(id: string, html: string, blank: boolean): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = html;
    el.classList.toggle('blank', blank);
  }

  set(
    'stripTPS',
    s.tokens_per_second != null ? s.tokens_per_second.toFixed(1) : '—',
    s.tokens_per_second == null
  );

  set(
    'stripTTFT',
    s.time_to_first_token != null
      ? `${s.time_to_first_token.toFixed(3)}<span class="stat-unit">s</span>`
      : '—',
    s.time_to_first_token == null
  );

  set(
    'stripGen',
    s.generation_time != null
      ? `${s.generation_time.toFixed(3)}<span class="stat-unit">s</span>`
      : '—',
    s.generation_time == null
  );

  set('stripTotal', u.total_tokens != null ? String(u.total_tokens) : '—', u.total_tokens == null);

  let costLabel = '—';
  if (options?.costUsd != null && options.costUsd > 0) {
    costLabel = formatUsd(options.costUsd);
  } else if (options?.costUsd === undefined) {
    const ledger = getActiveChat().tokenLedger;
    const lastEntry = ledger?.entries?.[ledger.entries.length - 1];
    if (lastEntry?.costUsd != null && lastEntry.costUsd > 0) {
      costLabel = formatUsd(lastEntry.costUsd);
    }
  }
  set('stripCost', costLabel, costLabel === '—');

  const p = u.prompt_tokens ?? 0;
  const c = u.completion_tokens ?? 0;
  const t = p + c || 1;
  const barPrompt = document.getElementById('barPrompt');
  const barCompletion = document.getElementById('barCompletion');
  const cntPrompt = document.getElementById('cntPrompt');
  const cntCompletion = document.getElementById('cntCompletion');
  if (barPrompt && barCompletion && cntPrompt && cntCompletion) {
    barPrompt.style.setProperty('--fill-scale', String(p / t || 0));
    barCompletion.style.setProperty('--fill-scale', String(c / t || 0));
    cntPrompt.textContent = p ? String(p) : '—';
    cntCompletion.textContent = c ? String(c) : '—';
  }

  const archEl = document.getElementById('iArch');
  const quantEl = document.getElementById('iQuant');
  const ctxEl = document.getElementById('iCtx');
  const stopEl = document.getElementById('iStop');
  if (!archEl || !quantEl || !ctxEl || !stopEl) {
    return;
  }
  archEl.textContent = m.arch ?? '—';
  quantEl.textContent = m.quant ?? '—';
  ctxEl.textContent = m.context_length != null ? String(m.context_length) : '—';
  stopEl.textContent = s.stop_reason ?? '—';
  [archEl, quantEl, ctxEl].forEach((el) => {
    el.classList.toggle('lit', el.textContent !== '—');
  });
  stopEl.classList.toggle('lit', stopEl.textContent !== '—');
  updateStatsExpandPreview();
}
