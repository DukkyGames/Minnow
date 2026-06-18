/**
 * Models → Installed — download queue, artifacts, and serve controls.
 */

import { selectProviderModel } from '../../api/models';
import {
  cancelModelDownload,
  fetchInstalledModels,
  fetchRuntimes,
  listModelServes,
  startModelServe,
  stopModelServe,
  subscribeDownloadProgress,
  type DownloadJob,
  type InstalledArtifact,
  type RuntimeDetection,
  type ServeRecord,
} from '../../models/api-client';
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

async function useServedModelInChat(serve: ServeRecord): Promise<void> {
  const picked = await selectProviderModel(serve.providerId, serve.modelLabel);
  if (picked) {
    setStatus('ok', 'Model selected in the top bar.');
  } else {
    setStatus('ok', 'Provider active — pick the model in the top bar if needed.');
  }
}

function renderArtifactRow(
  artifact: InstalledArtifact,
  serves: ServeRecord[],
  runtimes: RuntimeDetection | null,
): HTMLElement {
  const row = el('article', 'models-installed-row');
  const head = el('div', 'models-installed-row__head');
  head.append(
    el('span', 'models-installed-name', artifact.filename),
    el('span', 'models-muted', formatBytes(artifact.sizeBytes)),
  );
  row.appendChild(head);
  row.appendChild(el('p', 'models-recommend-meta', artifact.path));

  const active = serves.find(
    (s) => s.modelPath === artifact.path && (s.status === 'running' || s.status === 'starting'),
  );

  const actions = el('div', 'models-installed-actions');
  if (active) {
    const stopBtn = el('button', 'models-inline-btn', 'Stop');
    stopBtn.type = 'button';
    stopBtn.addEventListener('click', () => {
      void stopModelServe(active.id).then(() => refreshInstalledSection());
    });
    const useBtn = el('button', 'models-inline-btn is-primary', 'Use in chat');
    useBtn.type = 'button';
    useBtn.addEventListener('click', () => {
      void useServedModelInChat(active);
    });
    actions.append(stopBtn, useBtn);
  } else {
    const llamaBtn = el('button', 'models-inline-btn is-primary', 'Serve (llama.cpp)');
    llamaBtn.type = 'button';
    const llamaReady = Boolean(runtimes?.llamaCpp.path);
    const llamaInstallable = runtimes?.llamaCpp.installable ?? false;
    llamaBtn.disabled = !llamaReady && !llamaInstallable;
    llamaBtn.title = llamaReady
      ? 'Start llama-server for this GGUF'
      : llamaInstallable
        ? 'Install llama.cpp runtime (~20 MB), then configure serve options'
        : 'Install llama-server and add it to PATH';
    llamaBtn.addEventListener('click', () => {
      void openServeDialog({
        modelPath: artifact.path,
        modelLabel: artifact.filename,
      })
        .then((serve) => {
          if (!serve) return;
          return useServedModelInChat(serve);
        })
        .then(() => refreshInstalledSection())
        .catch((err) => {
          setStatus('err', err instanceof Error ? err.message : 'Serve failed');
        });
    });

    const ollamaBtn = el('button', 'models-inline-btn', 'Use Ollama');
    ollamaBtn.type = 'button';
    ollamaBtn.disabled = !runtimes?.ollama.serving;
    ollamaBtn.title = runtimes?.ollama.serving
      ? 'Register Ollama as the active provider'
      : 'Start Ollama on http://127.0.0.1:11434';
    ollamaBtn.addEventListener('click', () => {
      ollamaBtn.disabled = true;
      void startModelServe({
        modelPath: artifact.path,
        runtime: 'ollama',
        modelLabel: artifact.repoId || artifact.filename,
      })
        .then((serve) => useServedModelInChat(serve))
        .then(() => refreshInstalledSection())
        .catch((err) => {
          setStatus('err', err instanceof Error ? err.message : 'Ollama register failed');
          ollamaBtn.disabled = false;
        });
    });

    const lmBtn = el('button', 'models-inline-btn', 'Use LM Studio');
    lmBtn.type = 'button';
    lmBtn.disabled = !runtimes?.lmStudio.available;
    lmBtn.title = runtimes?.lmStudio.available
      ? 'Register LM Studio as the active provider'
      : 'Start LM Studio server on http://127.0.0.1:1234';
    lmBtn.addEventListener('click', () => {
      lmBtn.disabled = true;
      void startModelServe({
        modelPath: artifact.path,
        runtime: 'lm-studio',
        modelLabel: artifact.filename,
      })
        .then((serve) => useServedModelInChat(serve))
        .then(() => refreshInstalledSection())
        .catch((err) => {
          setStatus('err', err instanceof Error ? err.message : 'LM Studio register failed');
          lmBtn.disabled = false;
        });
    });

    actions.append(llamaBtn, ollamaBtn, lmBtn);
  }
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
          ? 'not installed — Serve will prompt to install'
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
    const [{ artifacts, downloads }, serves, runtimes] = await Promise.all([
      fetchInstalledModels(),
      listModelServes(),
      fetchRuntimes(),
    ]);

    mount.replaceChildren();
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
        el('p', 'models-muted', 'No GGUF files yet — download a model from What fits.'),
      );
      return;
    }
    const list = el('div', 'models-installed-list');
    for (const artifact of artifacts) {
      list.appendChild(renderArtifactRow(artifact, serves, runtimes));
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
