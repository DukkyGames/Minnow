/**
 * Settings → Memory: semantic embeddings controls (hybrid retrieval).
 */

import {
  fetchMemoryEmbeddingsStatus,
  reindexMemoryEmbeddings,
  saveMemoryEmbeddingsConfig,
  warmupMemoryEmbeddings,
} from '../memory/client';
import type { MemoryEmbeddingsConfig, MemoryEmbeddingsStatus } from '../memory/types';
import { fillProviderSelect } from './settings-model-binding';

type StatusFn = (kind: 'ok' | 'err' | 'spin', message: string) => void;

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

function readEmbeddingsForm(): Partial<MemoryEmbeddingsConfig> {
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
  ) as HTMLSelectElement | null;
  const blendEl = document.getElementById(
    'settingsMemoryEmbeddingsBlend',
  ) as HTMLInputElement | null;

  return {
    enabled: enabledEl?.checked === true,
    backend: (backendEl?.value === 'provider' ? 'provider' : 'local') as 'local' | 'provider',
    modelId: modelEl?.value.trim() ?? '',
    providerId: providerEl?.value.trim() ?? '',
    blendWeight: Number(blendEl?.value ?? 0.5),
  };
}

function validateEmbeddingsForm(partial: Partial<MemoryEmbeddingsConfig>): string | null {
  if (!partial.enabled) return null;
  if (!partial.modelId?.trim()) {
    return 'Model id is required when semantic embeddings are enabled.';
  }
  if (partial.backend === 'provider' && !partial.providerId?.trim()) {
    return 'Select a provider when using provider embeddings.';
  }
  return null;
}

/** Download/warmup always needs a local model id; provider warmup also requires enable + provider. */
function validateDownloadForm(partial: Partial<MemoryEmbeddingsConfig>): string | null {
  if (partial.backend === 'provider') {
    if (!partial.enabled) {
      return 'Enable semantic embeddings before probing a provider backend.';
    }
    if (!partial.providerId?.trim()) {
      return 'Select a provider when using provider embeddings.';
    }
    if (!partial.modelId?.trim()) {
      return 'Model id is required when using provider embeddings.';
    }
    return null;
  }
  if (!partial.modelId?.trim()) {
    return 'Model id is required to download a local embedding model.';
  }
  return null;
}

function setEmbeddingsPanelStatus(message: string): void {
  const statusEl = document.getElementById('settingsMemoryEmbeddingsStatus');
  if (statusEl) statusEl.textContent = message;
}

function toggleDownloadButtonVisibility(): void {
  const backendEl = document.getElementById(
    'settingsMemoryEmbeddingsBackend',
  ) as HTMLSelectElement | null;
  const downloadBtn = document.getElementById('settingsMemoryEmbeddingsDownload');
  if (!downloadBtn || !backendEl) return;
  downloadBtn.classList.toggle('hidden', backendEl.value !== 'local');
}

function bindEmbeddingsControls(setStatus: StatusFn): void {
  const enabledEl = document.getElementById(
    'settingsMemoryEmbeddingsEnabled',
  ) as HTMLInputElement | null;
  const backendEl = document.getElementById(
    'settingsMemoryEmbeddingsBackend',
  ) as HTMLSelectElement | null;
  const blendEl = document.getElementById(
    'settingsMemoryEmbeddingsBlend',
  ) as HTMLInputElement | null;
  const saveBtn = document.getElementById('settingsMemoryEmbeddingsSave');
  const downloadBtn = document.getElementById('settingsMemoryEmbeddingsDownload');
  const reindexBtn = document.getElementById('settingsMemoryEmbeddingsReindex');

  enabledEl?.addEventListener('change', () => {
    toggleProviderFieldVisibility();
    toggleDownloadButtonVisibility();
  });

  backendEl?.addEventListener('change', () => {
    toggleProviderFieldVisibility();
    toggleDownloadButtonVisibility();
  });

  blendEl?.addEventListener('input', () => {
    const label = document.getElementById('settingsMemoryEmbeddingsBlendLabel');
    if (label && blendEl) {
      label.textContent = formatBlendWeight(Number(blendEl.value));
    }
  });

  saveBtn?.addEventListener('click', () => {
    void (async () => {
      const partial = readEmbeddingsForm();
      const validationError = validateEmbeddingsForm(partial);
      if (validationError) {
        setStatus('err', validationError);
        return;
      }

      const saved = await saveMemoryEmbeddingsConfig(partial);
      if (saved.kind === 'err') {
        setStatus('err', saved.error);
        return;
      }
      setStatus('ok', 'Embeddings settings saved');
      const panel = document.getElementById('settingsMemoryEmbeddingsPanel');
      if (panel) await refreshMemoryEmbeddingsPanel(panel);
    })();
  });

  downloadBtn?.addEventListener('click', () => {
    void (async () => {
      downloadBtn.setAttribute('disabled', 'true');
      try {
        const partial = readEmbeddingsForm();
        const validationError = validateDownloadForm(partial);
        if (validationError) {
          setEmbeddingsPanelStatus(validationError);
          setStatus('err', validationError);
          return;
        }

        setEmbeddingsPanelStatus('Saving settings…');
        const saved = await saveMemoryEmbeddingsConfig(partial);
        if (saved.kind === 'err') {
          setEmbeddingsPanelStatus(saved.error);
          setStatus('err', saved.error);
          return;
        }

        setEmbeddingsPanelStatus(
          'Downloading embedding model. First run may take a few minutes. Files save to ~/.minnow/models/embeddings/',
        );
        setStatus('spin', 'Downloading embedding model…');
        const result = await warmupMemoryEmbeddings();
        if (result.kind === 'err') {
          setEmbeddingsPanelStatus(result.error);
          setStatus('err', result.error);
          return;
        }
        const readyMsg = `Model ready: ${result.value.model} (${result.value.dim} dims, ${result.value.durationMs} ms)`;
        setEmbeddingsPanelStatus(readyMsg);
        setStatus('ok', readyMsg);
        const panel = document.getElementById('settingsMemoryEmbeddingsPanel');
        if (panel) await refreshMemoryEmbeddingsPanel(panel);
      } finally {
        downloadBtn.removeAttribute('disabled');
      }
    })();
  });

  reindexBtn?.addEventListener('click', () => {
    void (async () => {
      reindexBtn.setAttribute('disabled', 'true');
      try {
        const partial = readEmbeddingsForm();
        const validationError = validateEmbeddingsForm(partial);
        if (validationError) {
          setStatus('err', validationError);
          return;
        }

        const saved = await saveMemoryEmbeddingsConfig(partial);
        if (saved.kind === 'err') {
          setStatus('err', saved.error);
          return;
        }

        const result = await reindexMemoryEmbeddings();
        if (result.kind === 'err') {
          setEmbeddingsPanelStatus(result.error);
          setStatus('err', result.error);
          return;
        }
        const reindexMsg = `Reindexed ${result.value.indexed} wiki pages (${result.value.failed} failed, ${result.value.durationMs} ms)`;
        setEmbeddingsPanelStatus(reindexMsg);
        setStatus('ok', reindexMsg);
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
  ) as HTMLSelectElement | null;
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
    if (modelEl && !modelEl.value.trim()) {
      modelEl.value = 'Xenova/all-MiniLM-L6-v2';
    }
    return;
  }

  container.classList.remove('settings-memory-embeddings--offline');

  if (enabledEl) enabledEl.checked = status.enabled;
  if (backendEl) backendEl.value = status.backend === 'provider' ? 'provider' : 'local';
  if (modelEl && !modelEl.matches(':focus')) modelEl.value = status.model;
  if (providerEl && !providerEl.matches(':focus')) {
    await fillProviderSelect(providerEl, status.providerId ?? '');
    if (status.providerId && providerEl.value !== status.providerId) {
      const missing = document.createElement('option');
      missing.value = status.providerId;
      missing.textContent = `${status.providerId} (missing)`;
      providerEl.appendChild(missing);
      providerEl.value = status.providerId;
    }
  }
  if (blendEl && !blendEl.matches(':focus')) {
    blendEl.value = String(status.blendWeight ?? 0.5);
    blendEl.dataset.savedBlend = String(status.blendWeight ?? 0.5);
    if (blendLabel) blendLabel.textContent = formatBlendWeight(Number(blendEl.value));
  }

  toggleProviderFieldVisibility();
  toggleDownloadButtonVisibility();

  if (statusEl) {
    if (!status.enabled) {
      statusEl.textContent = 'Semantic retrieval off. Matching uses keywords only on send.';
    } else {
      const pageHint =
        typeof status.pageCount === 'number' && status.pageCount > 0
          ? ` · ${status.pageCount} wiki pages`
          : '';
      statusEl.textContent = `${status.vectorCount} vectors indexed${pageHint} · dim ${status.dim} · model ${status.model} · ${status.healthy ? 'healthy' : 'needs reindex'}`;
    }
  }

  if (badgeEl) {
    badgeEl.classList.toggle('hidden', !status.reindexNeeded);
  }
}
