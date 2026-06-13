/**
 * Settings → Memory: semantic embeddings controls (hybrid retrieval).
 */

import {
  fetchMemoryEmbeddingsStatus,
  reindexMemoryEmbeddings,
  saveMemoryEmbeddingsConfig,
} from '../memory/client';
import type { MemoryEmbeddingsStatus } from '../memory/types';

type StatusFn = (kind: 'ok' | 'err', message: string) => void;

let bindingsDone = false;

function formatBlendWeight(value: number): string {
  return `${Math.round(value * 100)}% vector`;
}

/**
 * Render embeddings status line and wire controls once.
 */
export function mountMemoryEmbeddingsPanel(
  container: HTMLElement,
  setStatus: StatusFn,
): void {
  if (!bindingsDone) {
    bindingsDone = true;
    bindEmbeddingsControls(setStatus);
  }

  void refreshMemoryEmbeddingsPanel(container);
}

function bindEmbeddingsControls(setStatus: StatusFn): void {
  const enabledEl = document.getElementById(
    'settingsMemoryEmbeddingsEnabled',
  ) as HTMLInputElement | null;
  const backendEl = document.getElementById(
    'settingsMemoryEmbeddingsBackend',
  ) as HTMLSelectElement | null;
  const modelEl = document.getElementById(
    'settingsMemoryEmbeddingsModel',
  ) as HTMLInputElement | null;
  const providerEl = document.getElementById(
    'settingsMemoryEmbeddingsProvider',
  ) as HTMLInputElement | null;
  const blendEl = document.getElementById(
    'settingsMemoryEmbeddingsBlend',
  ) as HTMLInputElement | null;
  const saveBtn = document.getElementById('settingsMemoryEmbeddingsSave');
  const reindexBtn = document.getElementById('settingsMemoryEmbeddingsReindex');

  enabledEl?.addEventListener('change', () => {
    toggleProviderFieldVisibility();
  });

  backendEl?.addEventListener('change', () => {
    toggleProviderFieldVisibility();
  });

  blendEl?.addEventListener('input', () => {
    const label = document.getElementById('settingsMemoryEmbeddingsBlendLabel');
    if (label && blendEl) {
      label.textContent = formatBlendWeight(Number(blendEl.value));
    }
  });

  saveBtn?.addEventListener('click', () => {
    void (async () => {
      const partial = {
        enabled: enabledEl?.checked === true,
        backend: (backendEl?.value === 'provider' ? 'provider' : 'local') as
          | 'local'
          | 'provider',
        modelId: modelEl?.value.trim() ?? '',
        providerId: providerEl?.value.trim() ?? '',
        blendWeight: Number(blendEl?.value ?? 0.5),
      };
      const saved = await saveMemoryEmbeddingsConfig(partial);
      if (!saved) {
        setStatus('err', 'Could not save embeddings settings. Use npm start.');
        return;
      }
      setStatus('ok', 'Embeddings settings saved');
      const panel = document.getElementById('settingsMemoryEmbeddingsPanel');
      if (panel) await refreshMemoryEmbeddingsPanel(panel);
    })();
  });

  reindexBtn?.addEventListener('click', () => {
    void (async () => {
      reindexBtn.setAttribute('disabled', 'true');
      try {
        const result = await reindexMemoryEmbeddings();
        if (!result?.ok) {
          setStatus('err', 'Reindex failed. Enable embeddings and use npm start.');
          return;
        }
        setStatus(
          'ok',
          `Reindexed ${result.indexed} entries (${result.failed} failed, ${result.durationMs} ms)`,
        );
        const panel = document.getElementById('settingsMemoryEmbeddingsPanel');
        if (panel) await refreshMemoryEmbeddingsPanel(panel);
      } finally {
        reindexBtn.removeAttribute('disabled');
      }
    })();
  });
}

function toggleProviderFieldVisibility(): void {
  const backendEl = document.getElementById(
    'settingsMemoryEmbeddingsBackend',
  ) as HTMLSelectElement | null;
  const providerRow = document.getElementById('settingsMemoryEmbeddingsProviderRow');
  if (!providerRow || !backendEl) return;
  providerRow.classList.toggle('hidden', backendEl.value !== 'provider');
}

async function refreshMemoryEmbeddingsPanel(container: HTMLElement): Promise<void> {
  const statusEl = document.getElementById('settingsMemoryEmbeddingsStatus');
  const badgeEl = document.getElementById('settingsMemoryEmbeddingsReindexBadge');
  const enabledEl = document.getElementById(
    'settingsMemoryEmbeddingsEnabled',
  ) as HTMLInputElement | null;
  const backendEl = document.getElementById(
    'settingsMemoryEmbeddingsBackend',
  ) as HTMLSelectElement | null;
  const modelEl = document.getElementById(
    'settingsMemoryEmbeddingsModel',
  ) as HTMLInputElement | null;
  const providerEl = document.getElementById(
    'settingsMemoryEmbeddingsProvider',
  ) as HTMLInputElement | null;
  const blendEl = document.getElementById(
    'settingsMemoryEmbeddingsBlend',
  ) as HTMLInputElement | null;
  const blendLabel = document.getElementById('settingsMemoryEmbeddingsBlendLabel');

  const status: MemoryEmbeddingsStatus | null = await fetchMemoryEmbeddingsStatus();

  if (!status) {
    container.classList.add('settings-memory-embeddings--offline');
    if (statusEl) {
      statusEl.textContent = 'Start npm start to configure semantic embeddings.';
    }
    return;
  }

  container.classList.remove('settings-memory-embeddings--offline');

  if (enabledEl) enabledEl.checked = status.enabled;
  if (backendEl) backendEl.value = status.backend === 'provider' ? 'provider' : 'local';
  if (modelEl && !modelEl.matches(':focus')) modelEl.value = status.model;
  if (providerEl && !providerEl.matches(':focus')) providerEl.value = status.providerId ?? '';
  if (blendEl && !blendEl.matches(':focus')) {
    blendEl.value = String(status.blendWeight ?? 0.5);
    blendEl.dataset.savedBlend = String(status.blendWeight ?? 0.5);
    if (blendLabel) blendLabel.textContent = formatBlendWeight(Number(blendEl.value));
  }

  toggleProviderFieldVisibility();

  if (statusEl) {
    statusEl.textContent = status.enabled
      ? `${status.vectorCount} vectors indexed · dim ${status.dim} · ${status.healthy ? 'healthy' : 'needs reindex'}`
      : 'Semantic retrieval disabled — keyword-only matching on send.';
  }

  if (badgeEl) {
    badgeEl.classList.toggle('hidden', !status.reindexNeeded);
  }
}
