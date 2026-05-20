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

export function formatSidebarStatsPreview(ls: LastStats | null | undefined): string {
  if (!ls) return '—';
  const parts: string[] = [];
  if (ls.tokens_per_second != null) parts.push(`${Number(ls.tokens_per_second).toFixed(1)} tok/s`);
  if (ls.time_to_first_token != null) parts.push(`TTFT ${Number(ls.time_to_first_token).toFixed(2)}s`);
  if (ls.total_tokens != null) parts.push(`${ls.total_tokens} tok`);
  return parts.length ? parts.join(' · ') : '—';
}

export function toggleStatsPanel(): void {
  const strip = document.getElementById('statsStrip')!;
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
  const tps = document.getElementById('stripTPS')!.textContent.trim();
  const total = document.getElementById('stripTotal')!.textContent.trim();
  preview.textContent = `${tps} t/s · ${total} tokens`;
}

/** Refresh bottom metrics strip and token bars from latest turn data. */
export function updateStrip(
  stats: Stats | undefined,
  usage: Usage | undefined,
  modelInfo: ModelInfo | undefined
): void {
  const s = stats || {};
  const u = usage || {};
  const m = modelInfo || {};

  function set(id: string, html: string, blank: boolean): void {
    const el = document.getElementById(id)!;
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

  const p = u.prompt_tokens ?? 0;
  const c = u.completion_tokens ?? 0;
  const t = p + c || 1;
  document.getElementById('barPrompt')!.style.width = `${((p / t) * 100).toFixed(1)}%`;
  document.getElementById('barCompletion')!.style.width = `${((c / t) * 100).toFixed(1)}%`;
  document.getElementById('cntPrompt')!.textContent = p ? String(p) : '—';
  document.getElementById('cntCompletion')!.textContent = c ? String(c) : '—';

  document.getElementById('iArch')!.textContent = m.arch ?? '—';
  document.getElementById('iQuant')!.textContent = m.quant ?? '—';
  document.getElementById('iCtx')!.textContent =
    m.context_length != null ? String(m.context_length) : '—';
  document.getElementById('iStop')!.textContent = s.stop_reason ?? '—';

  const archEl = document.getElementById('iArch')!;
  const quantEl = document.getElementById('iQuant')!;
  const ctxEl = document.getElementById('iCtx')!;
  const stopEl = document.getElementById('iStop')!;
  [archEl, quantEl, ctxEl].forEach((el) => {
    el.classList.toggle('lit', el.textContent !== '—');
  });
  stopEl.classList.toggle('lit', stopEl.textContent !== '—');
  updateStatsExpandPreview();
}
