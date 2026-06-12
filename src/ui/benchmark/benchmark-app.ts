/**
 * Benchmark app shell: tabs, header, hash routing for #/app/bench/:tab.
 */

import type { BenchmarkTabId } from '../../benchmark/campaign-types.ts';
import { BENCHMARK_TAB_IDS } from '../../benchmark/campaign-types.ts';
import { invalidateChartsPanel, renderChartsPanel } from './charts-panel.ts';
import { renderOverviewPanel } from './overview-panel.ts';
import { initTestsPanelDrawer, renderTestsPanel } from './tests-panel.ts';

let activeTab: BenchmarkTabId = 'overview';

export function getActiveBenchmarkTab(): BenchmarkTabId {
  return activeTab;
}

export function parseBenchmarkTabFromHash(): BenchmarkTabId {
  const hash = window.location.hash;
  const osMatch = hash.match(/^#\/app\/bench(?:\/([\w-]+))?/);
  const legacyMatch = hash.match(/^#\/benchmark(?:\/([\w-]+))?/);
  const tab = osMatch?.[1] ?? legacyMatch?.[1];
  if (tab && (BENCHMARK_TAB_IDS as readonly string[]).includes(tab)) {
    return tab as BenchmarkTabId;
  }
  return 'overview';
}

function setTabButtonState(tab: BenchmarkTabId): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.benchmark-tab')) {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }
}

function showTabPanel(tab: BenchmarkTabId): void {
  for (const panel of document.querySelectorAll<HTMLElement>('.benchmark-tab-panel')) {
    const panelTab = panel.dataset.tab;
    const show = panelTab === tab;
    panel.hidden = !show;
    panel.classList.toggle('is-active', show);
  }
}

async function renderTabContent(tab: BenchmarkTabId): Promise<void> {
  if (tab === 'overview') {
    const mount = document.getElementById('benchmarkTabOverview');
    if (mount) await renderOverviewPanel(mount);
  }
  if (tab === 'charts') {
    const mount = document.getElementById('benchmarkTabCharts');
    if (mount) await renderChartsPanel(mount);
  }
  if (tab === 'tests') {
    const mount = document.getElementById('benchmarkTabTests');
    if (mount) await renderTestsPanel(mount);
  }
}

export function navigateBenchmarkTab(tab: BenchmarkTabId, options?: { replace?: boolean }): void {
  activeTab = tab;
  setTabButtonState(tab);
  showTabPanel(tab);
  void renderTabContent(tab);

  const base = window.location.hash.startsWith('#/app/') ? '#/app/bench' : '#/benchmark';
  const next = tab === 'overview' ? base : `${base}/${tab}`;
  if (window.location.hash !== next) {
    if (options?.replace) {
      history.replaceState(null, '', next);
    } else {
      window.location.hash = next;
    }
  }
}

export function initBenchmarkApp(): void {
  initTestsPanelDrawer();
  activeTab = parseBenchmarkTabFromHash();

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.benchmark-tab')) {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as BenchmarkTabId | undefined;
      if (tab) navigateBenchmarkTab(tab);
    });
  }

  document.getElementById('btnBenchmarkHeaderRun')?.addEventListener('click', () => {
    navigateBenchmarkTab('run');
    document.getElementById('btnBenchmarkRun')?.click();
  });

  setTabButtonState(activeTab);
  showTabPanel(activeTab);
  void renderTabContent(activeTab);
}

export function onBenchmarkHashChange(): void {
  const tab = parseBenchmarkTabFromHash();
  if (tab !== activeTab) {
    activeTab = tab;
    setTabButtonState(tab);
    showTabPanel(tab);
    void renderTabContent(tab);
  }
}

export function notifyCampaignComplete(): void {
  invalidateChartsPanel();
  void renderOverviewPanel(document.getElementById('benchmarkTabOverview')!);
  if (activeTab === 'charts') {
    const mount = document.getElementById('benchmarkTabCharts');
    if (mount) void renderChartsPanel(mount);
  }
}
