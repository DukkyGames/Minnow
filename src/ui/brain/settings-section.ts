/**
 * Brain app — Settings section: synthesis cadence + embeddings (config.memory / config.synthesis).
 */

import {
  fetchMemoryEmbeddingsStatus,
  reindexMemoryEmbeddings,
  saveMemoryEmbeddingsConfig,
} from '../../memory/client';
import {
  fetchSynthesisConfig,
  saveSynthesisConfig,
} from '../../synthesis/client';
import { fetchBrainStatus } from '../../brain/client';

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
  ]);
}
