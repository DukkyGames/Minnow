/**
 * Brain app — Settings: synthesis, embeddings, and code index (config.brain.*).
 */

import {
  fetchBrainCodeConfig,
  fetchBrainCodeStatus,
  fetchBrainGitHookStatus,
  fetchBrainStatus,
  installBrainGitHook,
  saveBrainCodeConfig,
  uninstallBrainGitHook,
} from '../../brain/client';
import type { BrainCodeStatus } from '../../brain/types';
import {
  fetchMemoryEmbeddingsStatus,
  reindexMemoryEmbeddings,
  saveMemoryEmbeddingsConfig,
} from '../../memory/client';
import {
  fetchSynthesisConfig,
  saveSynthesisConfig,
} from '../../synthesis/client';

type StatusFn = (kind: 'ok' | 'err' | 'spin', message: string) => void;

let bindingsDone = false;

const setStatus: StatusFn = (kind, message) => {
  const el = document.getElementById('brainSettingsStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
};

function formatThrottleHint(pairs: number): string {
  if (pairs <= 1) return 'Runs after every completed user+assistant turn.';
  return `Runs after every ${pairs} completed user+assistant turns.`;
}

function bindSettingsSection(): void {
  if (bindingsDone) return;
  bindingsDone = true;

  const throttleEl = document.getElementById(
    'brainSynthesisThrottle',
  ) as HTMLInputElement | null;
  throttleEl?.addEventListener('input', () => {
    const hint = document.getElementById('brainSynthesisThrottleHint');
    if (hint && throttleEl) {
      hint.textContent = formatThrottleHint(
        Math.max(1, Math.round(Number(throttleEl.value) || 1)),
      );
    }
  });

  document.getElementById('brainSynthesisSave')?.addEventListener('click', () => {
    void (async () => {
      const enabledEl = document.getElementById(
        'brainSynthesisEnabled',
      ) as HTMLInputElement | null;
      const throttle = Number(throttleEl?.value ?? 4);
      if (!Number.isFinite(throttle) || throttle < 1) {
        setStatus('err', 'Throttle must be at least 1 message pair');
        return;
      }
      const saved = await saveSynthesisConfig({
        enabled: enabledEl?.checked === true,
        throttleMessagePairs: Math.round(throttle),
      });
      setStatus(saved ? 'ok' : 'err', saved ? 'Synthesis settings saved' : 'Save failed');
      if (saved) await refreshSynthesisFields();
    })();
  });

  const blendEl = document.getElementById('brainEmbeddingsBlend') as HTMLInputElement | null;
  blendEl?.addEventListener('input', () => {
    const label = document.getElementById('brainEmbeddingsBlendLabel');
    if (label && blendEl) {
      label.textContent = `${Math.round(Number(blendEl.value) * 100)}% vector`;
    }
  });

  document.getElementById('brainEmbeddingsBackend')?.addEventListener('change', () => {
    toggleProviderRow();
  });
  document.getElementById('brainEmbeddingsEnabled')?.addEventListener('change', () => {
    toggleProviderRow();
  });

  document.getElementById('brainEmbeddingsSave')?.addEventListener('click', () => {
    void (async () => {
      const enabledEl = document.getElementById(
        'brainEmbeddingsEnabled',
      ) as HTMLInputElement | null;
      const backendEl = document.getElementById(
        'brainEmbeddingsBackend',
      ) as HTMLSelectElement | null;
      const modelEl = document.getElementById('brainEmbeddingsModel') as HTMLInputElement | null;
      const providerEl = document.getElementById(
        'brainEmbeddingsProvider',
      ) as HTMLInputElement | null;
      const saved = await saveMemoryEmbeddingsConfig({
        enabled: enabledEl?.checked === true,
        backend: backendEl?.value === 'provider' ? 'provider' : 'local',
        modelId: modelEl?.value.trim() ?? '',
        providerId: providerEl?.value.trim() ?? '',
        blendWeight: Number(blendEl?.value ?? 0.5),
      });
      setStatus(saved ? 'ok' : 'err', saved ? 'Embeddings settings saved' : 'Save failed');
      if (saved) await refreshEmbeddingsFields();
    })();
  });

  document.getElementById('brainEmbeddingsReindex')?.addEventListener('click', () => {
    void (async () => {
      setStatus('spin', 'Reindexing vectors…');
      const result = await reindexMemoryEmbeddings();
      setStatus(
        result?.ok ? 'ok' : 'err',
        result?.ok ? `Indexed ${result.indexed} pages` : 'Reindex failed',
      );
      await refreshEmbeddingsFields();
    })();
  });

  document.getElementById('brainCodeGitHookInstall')?.addEventListener('click', () => {
    void (async () => {
      setStatus('spin', 'Installing git hook…');
      const result = await installBrainGitHook();
      setStatus(
        result?.installed ? 'ok' : 'err',
        result?.installed
          ? result.alreadyPresent
            ? 'Git hook already installed'
            : 'Git post-commit hook installed'
          : 'Git hook install failed',
      );
      await refreshGitHookStatus();
    })();
  });

  document.getElementById('brainCodeGitHookUninstall')?.addEventListener('click', () => {
    void (async () => {
      setStatus('spin', 'Removing git hook…');
      const result = await uninstallBrainGitHook();
      setStatus(
        result?.removed ? 'ok' : 'err',
        result?.removed ? 'Git hook removed' : 'Git hook was not installed',
      );
      await refreshGitHookStatus();
    })();
  });

  document.getElementById('brainCodeSettingsSave')?.addEventListener('click', () => {
    void (async () => {
      const enabledEl = document.getElementById(
        'brainCodeEnabled',
      ) as HTMLInputElement | null;
      const includeEl = document.getElementById(
        'brainCodeIncludeGlobs',
      ) as HTMLTextAreaElement | null;
      const excludeEl = document.getElementById(
        'brainCodeExcludeGlobs',
      ) as HTMLTextAreaElement | null;
      const budgetEl = document.getElementById(
        'brainCodeTokenBudget',
      ) as HTMLInputElement | null;
      const cadenceEl = document.getElementById(
        'brainCodeReindexCadence',
      ) as HTMLSelectElement | null;
      const embEl = document.getElementById(
        'brainCodeEmbeddingsEnabled',
      ) as HTMLInputElement | null;
      const scaffoldEl = document.getElementById(
        'brainCodeAutoScaffold',
      ) as HTMLInputElement | null;
      const budget = Number(budgetEl?.value ?? 1500);
      if (!Number.isFinite(budget) || budget < 200) {
        setStatus('err', 'Token budget must be at least 200');
        return;
      }
      const parseLines = (raw: string) =>
        raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      const saved = await saveBrainCodeConfig({
        enabled: enabledEl?.checked === true,
        includeGlobs: parseLines(includeEl?.value ?? ''),
        excludeGlobs: parseLines(excludeEl?.value ?? ''),
        repoMapTokenBudget: Math.round(budget),
        reindexCadence:
          cadenceEl?.value === 'on-switch' || cadenceEl?.value === 'git-hook'
            ? cadenceEl.value
            : 'on-demand',
        codeEmbeddingsEnabled: embEl?.checked === true,
        autoScaffoldIndexConfig: scaffoldEl?.checked !== false,
      });
      setStatus(saved ? 'ok' : 'err', saved ? 'Code index settings saved' : 'Save failed');
      if (saved) await refreshCodeSettingsFields();
    })();
  });
}

function toggleProviderRow(): void {
  const backendEl = document.getElementById('brainEmbeddingsBackend') as HTMLSelectElement | null;
  const row = document.getElementById('brainEmbeddingsProviderRow');
  if (!row || !backendEl) return;
  row.classList.toggle('hidden', backendEl.value !== 'provider');
}

async function refreshSynthesisFields(): Promise<void> {
  const offlineEl = document.getElementById('brainSynthesisOffline');
  const enabledEl = document.getElementById('brainSynthesisEnabled') as HTMLInputElement | null;
  const throttleEl = document.getElementById('brainSynthesisThrottle') as HTMLInputElement | null;
  const hint = document.getElementById('brainSynthesisThrottleHint');
  const config = await fetchSynthesisConfig();
  offlineEl?.classList.toggle('hidden', config !== null);
  if (!config) return;
  if (enabledEl && !enabledEl.matches(':focus')) {
    enabledEl.checked = config.enabled !== false;
  }
  if (throttleEl && !throttleEl.matches(':focus')) {
    throttleEl.value = String(config.throttleMessagePairs ?? 4);
  }
  if (hint && throttleEl) {
    hint.textContent = formatThrottleHint(
      Math.max(1, Math.round(Number(throttleEl.value) || 1)),
    );
  }
}

async function refreshEmbeddingsFields(): Promise<void> {
  const offlineEl = document.getElementById('brainEmbeddingsOffline');
  const statusEl = document.getElementById('brainEmbeddingsStatus');
  const enabledEl = document.getElementById('brainEmbeddingsEnabled') as HTMLInputElement | null;
  const backendEl = document.getElementById('brainEmbeddingsBackend') as HTMLSelectElement | null;
  const modelEl = document.getElementById('brainEmbeddingsModel') as HTMLInputElement | null;
  const providerEl = document.getElementById('brainEmbeddingsProvider') as HTMLInputElement | null;
  const blendEl = document.getElementById('brainEmbeddingsBlend') as HTMLInputElement | null;
  const label = document.getElementById('brainEmbeddingsBlendLabel');
  const badge = document.getElementById('brainEmbeddingsReindexBadge');

  const status = await fetchMemoryEmbeddingsStatus();
  offlineEl?.classList.toggle('hidden', status !== null);
  if (!status) {
    if (statusEl) statusEl.textContent = 'Embeddings unavailable.';
    return;
  }

  if (statusEl) {
    statusEl.textContent = status.enabled
      ? `${status.vectorCount} vectors · model ${status.model || '—'} · ${status.healthy ? 'healthy' : 'reindex recommended'}`
      : 'Semantic embeddings are disabled.';
  }
  badge?.classList.toggle('hidden', !status.reindexNeeded);

  if (enabledEl && !enabledEl.matches(':focus')) enabledEl.checked = status.enabled;
  if (backendEl && !backendEl.matches(':focus')) {
    backendEl.value = status.backend === 'provider' ? 'provider' : 'local';
  }
  if (modelEl && !modelEl.matches(':focus')) modelEl.value = status.model ?? '';
  if (providerEl && !providerEl.matches(':focus')) providerEl.value = status.providerId ?? '';
  if (blendEl && !blendEl.matches(':focus')) blendEl.value = String(status.blendWeight ?? 0.5);
  if (label && blendEl) {
    label.textContent = `${Math.round(Number(blendEl.value) * 100)}% vector`;
  }
  toggleProviderRow();
}

function formatCodeSettingsLine(status: BrainCodeStatus): string {
  const when = status.lastIndexedAt
    ? new Date(status.lastIndexedAt).toLocaleString()
    : 'never';
  return `${status.repo} · ${status.symbolCount} symbols · last indexed ${when}`;
}

function globsToText(globs: string[]): string {
  return globs.join('\n');
}

async function refreshGitHookStatus(): Promise<void> {
  const el = document.getElementById('brainCodeGitHookStatus');
  if (!el) return;
  const status = await fetchBrainGitHookStatus();
  if (!status) {
    el.textContent = 'Hook status unavailable.';
    return;
  }
  el.textContent = status.installed
    ? `Post-commit hook installed at ${status.hookPath}`
    : 'Post-commit hook not installed';
}

async function refreshCodeSettingsFields(): Promise<void> {
  const offlineEl = document.getElementById('brainCodeSettingsOffline');
  const statusEl = document.getElementById('brainCodeSettingsStatus');
  const enabledEl = document.getElementById('brainCodeEnabled') as HTMLInputElement | null;
  const includeEl = document.getElementById('brainCodeIncludeGlobs') as HTMLTextAreaElement | null;
  const excludeEl = document.getElementById('brainCodeExcludeGlobs') as HTMLTextAreaElement | null;
  const budgetEl = document.getElementById('brainCodeTokenBudget') as HTMLInputElement | null;
  const cadenceEl = document.getElementById('brainCodeReindexCadence') as HTMLSelectElement | null;
  const embEl = document.getElementById('brainCodeEmbeddingsEnabled') as HTMLInputElement | null;
  const scaffoldEl = document.getElementById('brainCodeAutoScaffold') as HTMLInputElement | null;

  const [config, status] = await Promise.all([
    fetchBrainCodeConfig(),
    fetchBrainCodeStatus(),
  ]);
  offlineEl?.classList.toggle('hidden', config !== null);

  if (statusEl) {
    statusEl.textContent = status
      ? formatCodeSettingsLine(status)
      : 'Code index unavailable.';
  }

  if (!config) return;

  if (enabledEl && !enabledEl.matches(':focus')) enabledEl.checked = config.enabled;
  if (includeEl && !includeEl.matches(':focus')) {
    includeEl.value = globsToText(config.includeGlobs);
  }
  if (excludeEl && !excludeEl.matches(':focus')) {
    excludeEl.value = globsToText(config.excludeGlobs);
  }
  if (budgetEl && !budgetEl.matches(':focus')) {
    budgetEl.value = String(config.repoMapTokenBudget);
  }
  if (cadenceEl && !cadenceEl.matches(':focus')) {
    cadenceEl.value = config.reindexCadence;
  }
  if (embEl && !embEl.matches(':focus')) {
    embEl.checked = config.codeEmbeddingsEnabled;
  }
  if (scaffoldEl && !scaffoldEl.matches(':focus')) {
    scaffoldEl.checked = config.autoScaffoldIndexConfig !== false;
  }
  await refreshGitHookStatus();
}

async function refreshBrainStatusLine(): Promise<void> {
  const line = document.getElementById('brainSettingsStatusLine');
  if (!line) return;
  const status = await fetchBrainStatus();
  if (!status) {
    line.textContent = 'Offline — start npm start.';
    return;
  }
  line.textContent = `${status.enabled ? 'Wiki enabled' : 'Wiki disabled'} · ${status.pageCount} pages`;
}

/** Load Brain settings fields from the server. */
export async function renderSettingsSection(): Promise<void> {
  bindSettingsSection();
  await Promise.all([
    refreshBrainStatusLine(),
    refreshSynthesisFields(),
    refreshEmbeddingsFields(),
    refreshCodeSettingsFields(),
  ]);
}
