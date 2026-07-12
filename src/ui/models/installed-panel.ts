/**
 * Models → Installed — download queue, artifacts, and router load controls.
 */

import { selectProviderModel } from '../../api/models';
import {
  cancelModelDownload,
  fetchInstalledModels,
  fetchRouterStatus,
  fetchRuntimes,
  loadLocalModel,
  restartModelRouter,
  routerModelIdFromFilename,
  startModelRouter,
  stopModelRouter,
  subscribeDownloadProgress,
  unloadLocalModel,
  type DownloadJob,
  type InstalledArtifact,
  type RouterModelRow,
  type RouterStatus,
  type RuntimeDetection,
} from '../../models/api-client';
import { ensureLlamaRuntimeInstalled } from './llama-install-prompt';
import { openServeDialog } from './serve-dialog';
import { setStatus } from '../status';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let refreshTimer: number | null = null;
const progressUnsubs = new Map<string, () => void>();

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Build a set of loaded model ids from the router catalog. */
function loadedModelIds(loadedModels: { data?: RouterModelRow[] } | null): Set<string> {
  const ids = new Set<string>();
  for (const row of loadedModels?.data ?? []) {
    if (!row?.id) continue;
    const state = (row.state ?? '').toLowerCase();
    if (state === 'loaded' || state === 'loading' || !state) {
      ids.add(row.id);
    }
  }
  return ids;
}

function renderProgressBar(job: DownloadJob): HTMLElement {
  const wrap = el('div', 'models-download-progress');
  const pct =
    job.totalBytes && job.totalBytes > 0
      ? Math.min(100, Math.round((job.bytesReceived / job.totalBytes) * 100))
      : null;
  const bar = el('div', 'models-download-progress__bar');
  bar.style.width = pct != null ? `${pct}%` : '30%';
  if (pct == null) bar.classList.add('is-indeterminate');
  wrap.appendChild(bar);
  const label = el(
    'span',
    'models-download-progress__label',
    pct != null
      ? `${pct}% · ${formatBytes(job.bytesReceived)} / ${formatBytes(job.totalBytes || 0)}`
      : `${formatBytes(job.bytesReceived)} · ${job.status}`,
  );
  wrap.append(label);
  return wrap;
}

function ensureProgressSubscription(job: DownloadJob): void {
  if (progressUnsubs.has(job.id)) return;
  if (job.status !== 'queued' && job.status !== 'running') return;
  const unsub = subscribeDownloadProgress(job.id, () => {
    void refreshInstalledSection();
  });
  progressUnsubs.set(job.id, unsub);
}

function renderDownloadRow(job: DownloadJob): HTMLElement {
  ensureProgressSubscription(job);
  const row = el('article', 'models-installed-row');
  const head = el('div', 'models-installed-row__head');
  head.append(
    el('span', 'models-installed-name', `${job.repoId} · ${job.filename}`),
    el('span', `models-fit-badge models-download-status--${job.status}`, job.status),
  );
  row.appendChild(head);
  if (job.status === 'running' || job.status === 'queued') {
    row.appendChild(renderProgressBar(job));
    const cancel = el('button', 'models-inline-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      void cancelModelDownload(job.id).then(() => refreshInstalledSection());
    });
    row.appendChild(cancel);
  }
  if (job.error) {
    row.appendChild(el('p', 'models-error', job.error));
  }
  return row;
}

/** Ensure router is running, load the model, and select it in chat. */
async function useModelInChat(modelId: string): Promise<void> {
  const ready = await ensureLlamaRuntimeInstalled();
  if (!ready) return;

  await startModelRouter();
  try {
    await loadLocalModel(modelId);
  } catch (err) {
    setStatus('err', err instanceof Error ? err.message : 'Load failed');
    return;
  }

  const picked = await selectProviderModel('llama-cpp-local', modelId);
  if (picked) {
    setStatus('ok', 'Model loaded and selected.');
  } else {
    setStatus('ok', 'Model loaded — pick it in the top bar if needed.');
  }
}

function renderRouterCard(
  router: RouterStatus,
  loadedModels: { data?: RouterModelRow[] } | null,
): HTMLElement {
  const card = el('div', 'models-router-card');
  const head = el('div', 'models-router-card__head');
  const title = el('h3', 'models-hardware-card__title', 'llama.cpp router');
  const pillClass =
    router.status === 'running'
      ? 'models-router-pill--running'
      : router.status === 'starting'
        ? 'models-router-pill--starting'
        : router.status === 'error'
          ? 'models-router-pill--error'
          : 'models-router-pill--stopped';
  const pill = el('span', `models-router-pill ${pillClass}`, router.status);
  head.append(title, pill);
  card.appendChild(head);

  const loadedCount = loadedModelIds(loadedModels).size;
  const meta = el('p', 'models-muted');
  if (!router.routerSupported) {
    meta.textContent =
      'Router mode unavailable — update the llama.cpp runtime for multi-model switching.';
  } else if (router.status === 'running') {
    meta.textContent = `Port ${router.port} · ${loadedCount} loaded · max ${router.modelsMax}`;
  } else if (router.status === 'starting') {
    meta.textContent = `Starting on port ${router.port}…`;
  } else if (router.status === 'error') {
    meta.textContent = router.error ?? 'Router failed — see logs in Settings → Servers.';
  } else {
    meta.textContent = 'Stopped — load a model or start the router.';
  }
  card.appendChild(meta);

  if (router.routerSupported) {
    const actions = el('div', 'models-installed-actions');
    if (router.status === 'running' || router.status === 'starting') {
      const stopBtn = el('button', 'models-inline-btn', 'Stop router');
      stopBtn.type = 'button';
      stopBtn.addEventListener('click', () => {
        stopBtn.disabled = true;
        void stopModelRouter()
          .then(() => refreshInstalledSection())
          .catch((err) => {
            setStatus('err', err instanceof Error ? err.message : 'Stop failed');
            stopBtn.disabled = false;
          });
      });
      const restartBtn = el('button', 'models-inline-btn', 'Restart');
      restartBtn.type = 'button';
      restartBtn.addEventListener('click', () => {
        restartBtn.disabled = true;
        void restartModelRouter()
          .then(() => refreshInstalledSection())
          .catch((err) => {
            setStatus('err', err instanceof Error ? err.message : 'Restart failed');
            restartBtn.disabled = false;
          });
      });
      actions.append(stopBtn, restartBtn);
    } else {
      const startBtn = el('button', 'models-inline-btn is-primary', 'Start router');
      startBtn.type = 'button';
      startBtn.addEventListener('click', () => {
        void ensureLlamaRuntimeInstalled().then((ready) => {
          if (!ready) return;
          startBtn.disabled = true;
          void startModelRouter()
            .then(() => refreshInstalledSection())
            .catch((err) => {
              setStatus('err', err instanceof Error ? err.message : 'Start failed');
              startBtn.disabled = false;
            });
        });
      });
      actions.append(startBtn);
    }
    card.appendChild(actions);
  }

  return card;
}

function renderArtifactRow(
  artifact: InstalledArtifact,
  router: RouterStatus,
  loadedIds: Set<string>,
  runtimes: RuntimeDetection | null,
): HTMLElement {
  const modelId = routerModelIdFromFilename(artifact.filename);
  const isLoaded = loadedIds.has(modelId);

  const row = el('article', 'models-installed-row');
  const head = el('div', 'models-installed-row__head');
  head.append(
    el('span', 'models-installed-name', artifact.filename),
    el(
      'span',
      `models-load-badge ${isLoaded ? 'models-load-badge--loaded' : 'models-load-badge--disk'}`,
      isLoaded ? 'loaded' : 'on disk',
    ),
    el('span', 'models-muted', formatBytes(artifact.sizeBytes)),
  );
  row.appendChild(head);
  row.appendChild(el('p', 'models-recommend-meta', artifact.path));

  const actions = el('div', 'models-installed-actions');

  if (router.routerSupported) {
    if (isLoaded) {
      const unloadBtn = el('button', 'models-inline-btn', 'Unload');
      unloadBtn.type = 'button';
      unloadBtn.addEventListener('click', () => {
        unloadBtn.disabled = true;
        void unloadLocalModel(modelId)
          .then(() => refreshInstalledSection())
          .catch((err) => {
            setStatus('err', err instanceof Error ? err.message : 'Unload failed');
            unloadBtn.disabled = false;
          });
      });
      actions.appendChild(unloadBtn);
    } else {
      const loadBtn = el('button', 'models-inline-btn is-primary', 'Load');
      loadBtn.type = 'button';
      loadBtn.disabled = !runtimes?.llamaCpp.path && !runtimes?.llamaCpp.installable;
      loadBtn.addEventListener('click', () => {
        loadBtn.disabled = true;
        void useModelInChat(modelId)
          .then(() => refreshInstalledSection())
          .catch((err) => {
            setStatus('err', err instanceof Error ? err.message : 'Load failed');
            loadBtn.disabled = false;
          });
      });
      actions.appendChild(loadBtn);
    }

    const useBtn = el('button', 'models-inline-btn', 'Use in chat');
    useBtn.type = 'button';
    useBtn.addEventListener('click', () => {
      void useModelInChat(modelId).then(() => refreshInstalledSection());
    });

    const settingsBtn = el('button', 'models-inline-btn', 'Launch settings');
    settingsBtn.type = 'button';
    settingsBtn.addEventListener('click', () => {
      void openServeDialog({
        modelPath: artifact.path,
        modelLabel: artifact.filename,
        mode: 'settings',
      }).then(() => refreshInstalledSection());
    });

    actions.append(useBtn, settingsBtn);
  } else {
    const legacyBtn = el('button', 'models-inline-btn is-primary', 'Serve (legacy)');
    legacyBtn.type = 'button';
    legacyBtn.addEventListener('click', () => {
      void openServeDialog({
        modelPath: artifact.path,
        modelLabel: artifact.filename,
        mode: 'serve',
      }).then(() => refreshInstalledSection());
    });
    actions.appendChild(legacyBtn);
  }

  const ollamaBtn = el('button', 'models-inline-btn', 'Use Ollama');
  ollamaBtn.type = 'button';
  ollamaBtn.disabled = !runtimes?.ollama.serving;
  ollamaBtn.addEventListener('click', () => {
    void selectProviderModel('ollama', artifact.repoId || artifact.filename);
  });

  const lmBtn = el('button', 'models-inline-btn', 'Use LM Studio');
  lmBtn.type = 'button';
  lmBtn.disabled = !runtimes?.lmStudio.available;
  lmBtn.addEventListener('click', () => {
    void selectProviderModel('lm-studio-local', artifact.filename);
  });

  actions.append(ollamaBtn, lmBtn);
  row.appendChild(actions);
  return row;
}

function renderRuntimesCard(runtimes: RuntimeDetection): HTMLElement {
  const card = el('div', 'models-hardware-card');
  card.appendChild(el('h3', 'models-hardware-card__title', 'Runtimes'));
  const lines = [
    `llama-server: ${
      runtimes.llamaCpp.path
        ? runtimes.llamaCpp.path
        : runtimes.llamaCpp.installable
          ? 'not installed — Load will prompt to install'
          : 'not found'
    }`,
    `Ollama: ${runtimes.ollama.serving ? 'serving' : runtimes.ollama.available ? 'installed' : 'not found'}`,
    `LM Studio: ${runtimes.lmStudio.available ? runtimes.lmStudio.baseUrl : 'not reachable'}`,
  ];
  for (const line of lines) {
    card.appendChild(el('p', 'models-muted', line));
  }
  return card;
}

export async function refreshInstalledSection(): Promise<void> {
  const mount = document.getElementById('modelsInstalledBody');
  if (!mount) return;

  try {
    const [{ artifacts, downloads }, { router, loadedModels }, runtimes] = await Promise.all([
      fetchInstalledModels(),
      fetchRouterStatus(),
      fetchRuntimes(),
    ]);

    const loadedIds = loadedModelIds(loadedModels);

    mount.replaceChildren();
    mount.appendChild(renderRouterCard(router, loadedModels));
    mount.appendChild(renderRuntimesCard(runtimes));

    const activeDownloads = downloads.filter((j) => j.status === 'queued' || j.status === 'running');
    if (activeDownloads.length) {
      mount.appendChild(el('h3', 'models-section-subtitle', 'Downloads'));
      const list = el('div', 'models-installed-list');
      for (const job of activeDownloads) list.appendChild(renderDownloadRow(job));
      mount.appendChild(list);
    }

    mount.appendChild(el('h3', 'models-section-subtitle', 'On disk'));
    if (!artifacts.length) {
      mount.appendChild(
        el('p', 'models-muted', 'No GGUF files yet. Download one from Recommendations.'),
      );
      return;
    }
    const list = el('div', 'models-installed-list');
    for (const artifact of artifacts) {
      list.appendChild(renderArtifactRow(artifact, router, loadedIds, runtimes));
    }
    mount.appendChild(list);
  } catch (err) {
    mount.replaceChildren();
    mount.appendChild(
      el('p', 'models-error', err instanceof Error ? err.message : 'Failed to load installed models.'),
    );
  }
}

export function mountInstalledSection(): void {
  const mount = document.getElementById('modelsInstalledBody');
  if (!mount) return;
  if (refreshTimer != null) window.clearInterval(refreshTimer);
  void refreshInstalledSection();
  refreshTimer = window.setInterval(() => {
    if (!document.getElementById('modelsView')?.classList.contains('is-open')) return;
    const panel = document.getElementById('modelsSection-installed');
    if (!panel?.classList.contains('is-active')) return;
    void refreshInstalledSection();
  }, 4_000);
}
