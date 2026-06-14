/**
 * Models → Voice — runtime, STT catalog/downloads/settings, TTS shell.
 */

import { loadVoiceMeta, saveVoiceMeta, type VoiceConfig, type VoiceTtsLocalConfig } from '../../config/voice-meta';
import { fetchHardware } from '../../models/hardware-client';
import type { HardwareSnapshot } from '../../models/types';
import { fillProviderSelect } from '../settings-model-binding';
import { setStatus } from '../status';
import { STT_CATALOG, findSttCatalogEntry } from '../../voice/catalog-stt';
import { TTS_CATALOG, findTtsCatalogEntry } from '../../voice/catalog-tts';
import {
  cancelVoiceDownload,
  deleteVoiceModel,
  downloadVoiceModel,
  fetchRuntimeStatus,
  installRuntime,
  listClonePrompts,
  listInstalledVoiceModels,
  repairRuntime,
  startVoiceWorker,
  stopVoiceWorker,
  subscribeDownloadProgress,
  subscribeInstallProgress,
  uploadRefAudio,
  type InstalledVoiceManifest,
  type VoiceClonePrompt,
  type VoiceDownloadJob,
  type VoiceRuntimeHealth,
  type VoiceRuntimeStatus,
} from '../../voice/api-client';
import {
  fillSttProviderPanel,
  fillTtsBrowserPanel,
  fillTtsProviderPanel,
  getTtsRefAudioUpload,
  readSttLocalFromForm,
  readSttProviderFromForm,
  readTtsBrowserFromForm,
  readTtsLocalFromForm,
  readTtsProviderFromForm,
  renderSttSettingsForm,
  renderTtsSettingsForm,
  setSttBackendUi,
  setTtsBackendUi,
} from '../../voice/settings-form';
import { analyzeSttFit, analyzeTtsFit, VOICE_FIT_BADGE_CLASS } from '../../voice/voice-fit';
import { synthesizeSpeech } from '../voice-controls';

type VoiceSubSection = 'stt' | 'tts';

let mounted = false;
let activeSub: VoiceSubSection = 'stt';
let runtimeStatus: VoiceRuntimeStatus | null = null;
let installUnsub: (() => void) | null = null;
let hardware: HardwareSnapshot | null = null;
let installedManifest: InstalledVoiceManifest | null = null;
let voiceConfig: VoiceConfig | null = null;
let sttBackend: 'local' | 'provider' = 'local';
let ttsBackend: 'local' | 'provider' | 'browser' = 'local';
let clonePrompts: VoiceClonePrompt[] = [];
const downloadUnsubs = new Map<string, () => void>();
const activeDownloads = new Map<string, VoiceDownloadJob>();

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function setActiveSubSection(sub: VoiceSubSection): void {
  activeSub = sub;
  document.getElementById('modelsVoiceSttPanel')?.classList.toggle('is-active', sub === 'stt');
  document.getElementById('modelsVoiceTtsPanel')?.classList.toggle('is-active', sub === 'tts');
  for (const id of ['stt', 'tts'] as const) {
    document
      .querySelector(`[data-voice-subnav="${id}"]`)
      ?.setAttribute('aria-current', id === sub ? 'page' : 'false');
  }
}

function healthLabel(health: VoiceRuntimeHealth): string {
  switch (health) {
    case 'ready':
      return 'Ready';
    case 'installing':
      return 'Installing…';
    case 'starting':
      return 'Starting…';
    case 'stopped':
      return 'Stopped';
    case 'error':
      return 'Error';
    default:
      return 'Not installed';
  }
}

function updateRuntimeCardUi(): void {
  const card = document.querySelector('.models-voice-runtime-card');
  if (!card || !runtimeStatus) return;

  const statusEl = card.querySelector('.models-voice-runtime-card__status');
  const leadEl = card.querySelector('.models-voice-runtime-card__lead');
  const progressEl = card.querySelector('.models-voice-runtime-card__progress');
  const installBtn = card.querySelector('[data-voice-action="install"]') as HTMLButtonElement | null;
  const repairBtn = card.querySelector('[data-voice-action="repair"]') as HTMLButtonElement | null;
  const startBtn = card.querySelector('[data-voice-action="start"]') as HTMLButtonElement | null;
  const stopBtn = card.querySelector('[data-voice-action="stop"]') as HTMLButtonElement | null;

  if (statusEl) {
    statusEl.textContent = healthLabel(runtimeStatus.health);
    statusEl.classList.toggle('models-fit-badge--good', runtimeStatus.health === 'ready');
    statusEl.classList.toggle(
      'models-fit-badge--marginal',
      runtimeStatus.health === 'installing' || runtimeStatus.health === 'starting',
    );
    statusEl.classList.toggle('models-fit-badge--tight', runtimeStatus.health === 'error');
  }

  if (leadEl) {
    const parts = ['Local Whisper STT and Qwen3-TTS run in a managed Python worker on this machine.'];
    parts.push(runtimeStatus.cudaAvailable ? 'CUDA GPU detected.' : 'CPU mode (no CUDA GPU detected).');
    if (runtimeStatus.running && runtimeStatus.port) {
      parts.push(`Worker listening on 127.0.0.1:${runtimeStatus.port}.`);
    }
    if (runtimeStatus.installJob?.message) parts.push(runtimeStatus.installJob.message);
    leadEl.textContent = parts.join(' ');
  }

  if (progressEl) {
    const job = runtimeStatus.installJob;
    if (job?.phase === 'installing') {
      progressEl.textContent = `${job.percent}% — ${job.message}`;
      progressEl.classList.remove('is-hidden');
    } else if (job?.phase === 'failed' && job.error) {
      progressEl.textContent = job.error;
      progressEl.classList.remove('is-hidden');
    } else {
      progressEl.textContent = '';
      progressEl.classList.add('is-hidden');
    }
  }

  const installing = runtimeStatus.health === 'installing';
  const installed = runtimeStatus.installed;
  const running = runtimeStatus.running;

  if (installBtn) {
    installBtn.disabled = installing || installed;
    installBtn.classList.toggle('is-hidden', installed);
  }
  if (repairBtn) {
    repairBtn.disabled = installing;
    repairBtn.classList.toggle('is-hidden', !installed);
  }
  if (startBtn) startBtn.disabled = installing || !installed || running;
  if (stopBtn) stopBtn.disabled = installing || !running;
}

async function refreshRuntimeStatus(): Promise<void> {
  try {
    runtimeStatus = await fetchRuntimeStatus();
    updateRuntimeCardUi();
  } catch {
    runtimeStatus = {
      installed: false,
      running: false,
      health: 'error',
      cudaAvailable: false,
      port: null,
      installedAt: null,
      installedPackages: [],
      skippedPackages: [],
      installJob: null,
      worker: { ok: false, status: 'error' },
    };
    updateRuntimeCardUi();
  }
}

function beginInstallProgressStream(): void {
  installUnsub?.();
  installUnsub = subscribeInstallProgress((event) => {
    if (!runtimeStatus) return;
    runtimeStatus = {
      ...runtimeStatus,
      health: event.phase === 'installing' ? 'installing' : runtimeStatus.health,
      installJob: event,
    };
    updateRuntimeCardUi();
    if (event.phase === 'completed' || event.phase === 'failed') {
      installUnsub?.();
      installUnsub = null;
      void refreshRuntimeStatus();
    }
  });
}

function renderRuntimeCard(mount: HTMLElement): void {
  const card = el('article', 'models-voice-runtime-card');
  card.dataset.settingsSearchKey = 'models.voice.runtime';

  const head = el('div', 'models-voice-runtime-card__head');
  head.append(
    el('h3', 'models-voice-runtime-card__title', 'Python voice runtime'),
    el('span', 'models-fit-badge models-voice-runtime-card__status', 'Not installed'),
  );
  card.appendChild(head);
  card.appendChild(
    el(
      'p',
      'models-voice-runtime-card__lead',
      'Local Whisper STT and Qwen3-TTS run in a managed Python worker on this machine.',
    ),
  );
  card.appendChild(el('p', 'models-voice-runtime-card__progress field-hint is-hidden'));

  const actions = el('div', 'models-voice-runtime-card__actions');
  const installBtn = el('button', 'models-inline-btn is-primary', 'Install runtime');
  installBtn.type = 'button';
  installBtn.dataset.voiceAction = 'install';
  installBtn.addEventListener('click', () => {
    void (async () => {
      beginInstallProgressStream();
      await installRuntime();
      await refreshRuntimeStatus();
    })();
  });
  actions.appendChild(installBtn);

  const repairBtn = el('button', 'models-inline-btn', 'Repair');
  repairBtn.type = 'button';
  repairBtn.dataset.voiceAction = 'repair';
  repairBtn.classList.add('is-hidden');
  repairBtn.addEventListener('click', () => {
    void (async () => {
      beginInstallProgressStream();
      await repairRuntime();
      await refreshRuntimeStatus();
    })();
  });
  actions.appendChild(repairBtn);

  const startBtn = el('button', 'models-inline-btn', 'Start worker');
  startBtn.type = 'button';
  startBtn.dataset.voiceAction = 'start';
  startBtn.addEventListener('click', () => {
    void (async () => {
      await startVoiceWorker();
      await refreshRuntimeStatus();
    })();
  });
  actions.appendChild(startBtn);

  const stopBtn = el('button', 'models-inline-btn', 'Stop worker');
  stopBtn.type = 'button';
  stopBtn.dataset.voiceAction = 'stop';
  stopBtn.addEventListener('click', () => {
    void (async () => {
      await stopVoiceWorker();
      await refreshRuntimeStatus();
    })();
  });
  actions.appendChild(stopBtn);

  card.appendChild(actions);
  mount.appendChild(card);
}

function isModelInstalled(modelId: string, kind: 'stt' | 'tts' = 'stt'): boolean {
  const list = kind === 'stt' ? installedManifest?.stt : installedManifest?.tts;
  return list?.some((row) => row.modelId === modelId) ?? false;
}

function ensureDownloadSubscription(job: VoiceDownloadJob): void {
  if (downloadUnsubs.has(job.id)) return;
  if (job.status !== 'queued' && job.status !== 'running') return;
  const unsub = subscribeDownloadProgress(job.id, (event) => {
    const current = activeDownloads.get(job.id);
    if (current) {
      activeDownloads.set(job.id, {
        ...current,
        status: event.status,
        bytesReceived: event.bytesReceived,
        totalBytes: event.totalBytes,
        error: event.error ?? null,
      });
    }
    void refreshVoicePanelUi();
    if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
      downloadUnsubs.get(job.id)?.();
      downloadUnsubs.delete(job.id);
      void refreshInstalledManifest();
    }
  });
  downloadUnsubs.set(job.id, unsub);
}

function ensureTtsDownloadSubscription(job: VoiceDownloadJob): void {
  ensureDownloadSubscription(job);
}

function renderDownloadProgress(job: VoiceDownloadJob): HTMLElement {
  const wrap = el('div', 'models-download-progress');
  const pct =
    job.totalBytes && job.totalBytes > 0
      ? Math.min(100, Math.round((job.bytesReceived / job.totalBytes) * 100))
      : null;
  const bar = el('div', 'models-download-progress__bar');
  bar.style.width = pct != null ? `${pct}%` : '30%';
  if (pct == null) bar.classList.add('is-indeterminate');
  wrap.appendChild(bar);
  wrap.appendChild(
    el(
      'span',
      'models-download-progress__label',
      pct != null
        ? `${pct}% · ${formatBytes(job.bytesReceived)} / ${formatBytes(job.totalBytes || 0)}`
        : `${formatBytes(job.bytesReceived)} · ${job.status}`,
    ),
  );
  return wrap;
}

function renderSttCatalogRow(entry: (typeof STT_CATALOG)[number]): HTMLElement {
  const row = el('article', 'models-voice-catalog-row');
  const fit = hardware ? analyzeSttFit(entry, hardware) : null;
  const head = el('div', 'models-voice-catalog-row__head');
  head.append(el('span', 'models-voice-catalog-row__label', entry.label));
  if (fit) {
    head.append(
      el(
        'span',
        `models-fit-badge ${VOICE_FIT_BADGE_CLASS[fit.fitLevel]}`,
        fit.label,
      ),
    );
  } else {
    head.append(el('span', 'models-fit-badge', `~${entry.estVramGb} GB VRAM`));
  }
  row.appendChild(head);
  row.appendChild(
    el('p', 'models-voice-catalog-row__meta', `${entry.modelId} · ${entry.params}`),
  );

  const installed = isModelInstalled(entry.modelId, 'stt');
  const activeJob = [...activeDownloads.values()].find(
    (j) => j.modelId === entry.modelId && (j.status === 'queued' || j.status === 'running'),
  );

  if (activeJob) {
    ensureDownloadSubscription(activeJob);
    row.appendChild(renderDownloadProgress(activeJob));
    const cancelBtn = el('button', 'models-inline-btn', 'Cancel');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      void cancelVoiceDownload(activeJob.id).then(() => refreshSttPanelUi());
    });
    row.appendChild(cancelBtn);
  } else {
    const downloadBtn = el(
      'button',
      'models-inline-btn',
      installed ? 'Installed' : 'Download',
    );
    downloadBtn.type = 'button';
    downloadBtn.disabled = installed;
    downloadBtn.addEventListener('click', () => {
      void (async () => {
        try {
          const job = await downloadVoiceModel(entry.modelId, 'stt');
          activeDownloads.set(job.id, job);
          ensureDownloadSubscription(job);
          await refreshSttPanelUi();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Download failed';
          setStatus('err', message);
        }
      })();
    });
    row.appendChild(downloadBtn);
  }

  return row;
}

function renderInstalledList(): HTMLElement {
  const section = el('section', 'models-voice-installed');
  section.appendChild(el('h4', undefined, 'Installed STT models'));
  const list = el('div', 'models-voice-installed-list');
  const rows = installedManifest?.stt ?? [];
  if (!rows.length) {
    list.appendChild(el('p', 'field-hint', 'No Whisper models downloaded yet.'));
  } else {
    for (const row of rows) {
      const item = el('article', 'models-voice-installed-row');
      const head = el('div', 'models-voice-installed-row__head');
      head.append(el('span', 'models-installed-name', row.modelId));
      if (row.sizeBytes) {
        head.append(el('span', 'models-muted', formatBytes(row.sizeBytes)));
      }
      item.appendChild(head);
      const actions = el('div', 'models-installed-actions');
      const useBtn = el('button', 'models-inline-btn', 'Use');
      useBtn.type = 'button';
      useBtn.addEventListener('click', () => {
        void applySttModelSelection(row.modelId);
      });
      const delBtn = el('button', 'models-inline-btn', 'Delete');
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => {
        void deleteVoiceModel('stt', row.modelId).then(() => refreshInstalledManifest());
      });
      actions.append(useBtn, delBtn);
      item.appendChild(actions);
      list.appendChild(item);
    }
  }
  section.appendChild(list);
  return section;
}

async function applySttModelSelection(modelId: string): Promise<void> {
  const entry = findSttCatalogEntry(modelId);
  const current = voiceConfig ?? (await loadVoiceMeta());
  const local = {
    ...current.stt.local,
    modelId,
    ...(entry?.recommendedDefaults ?? {}),
  };
  const saved = await saveVoiceMeta({
    stt: { backend: 'local', local },
  });
  if (saved) {
    voiceConfig = saved;
    sttBackend = 'local';
    renderSttSettingsSection();
    setStatus('ok', `STT model set to ${modelId}`);
    await refreshActiveBackendSummary();
  }
}

function renderSttSettingsSection(): void {
  const shell = document.getElementById('modelsVoiceSttSettings');
  if (!shell || !voiceConfig) return;
  const catalogEntry = findSttCatalogEntry(voiceConfig.stt.local.modelId);
  renderSttSettingsForm({
    mount: shell,
    config: voiceConfig,
    catalogEntry,
    onBackendChange: (backend) => {
      sttBackend = backend;
      setSttBackendUi(backend);
    },
  });
  void fillProviderSelect(
    document.getElementById('voiceSttProviderId') as HTMLSelectElement,
    voiceConfig.stt.provider.providerId,
  ).then(() => fillSttProviderPanel(voiceConfig!));
}

async function saveSttSettings(): Promise<void> {
  if (!voiceConfig) voiceConfig = await loadVoiceMeta();
  const local = readSttLocalFromForm(voiceConfig.stt.local);
  const provider = readSttProviderFromForm(voiceConfig);
  const saved = await saveVoiceMeta({
    stt: {
      enabled: true,
      backend: sttBackend,
      local,
      provider,
    },
  });
  if (!saved) {
    setStatus('err', 'Could not save STT settings. Use npm start.');
    return;
  }
  voiceConfig = saved;
  setStatus('ok', 'STT settings saved');
  await refreshActiveBackendSummary();
}

let micRecorder: MediaRecorder | null = null;
let micChunks: BlobPart[] = [];
let micStream: MediaStream | null = null;

async function runMicTest(): Promise<void> {
  const testBtn = document.getElementById('modelsVoiceSttTestMic') as HTMLButtonElement | null;
  const resultEl = document.getElementById('modelsVoiceSttTestResult');
  if (micRecorder?.state === 'recording') {
    micRecorder.stop();
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micChunks = [];
    micRecorder = new MediaRecorder(micStream);
    micRecorder.ondataavailable = (ev) => {
      if (ev.data.size) micChunks.push(ev.data);
    };
    micRecorder.onstop = () => {
      for (const track of micStream?.getTracks() ?? []) track.stop();
      micStream = null;
      micRecorder = null;
      if (testBtn) {
        testBtn.textContent = 'Test mic (5s)';
        testBtn.disabled = false;
      }
      void (async () => {
        const blob = new Blob(micChunks, { type: 'audio/webm' });
        micChunks = [];
        if (!blob.size) {
          if (resultEl) resultEl.textContent = 'No audio captured.';
          return;
        }
        if (resultEl) resultEl.textContent = 'Transcribing…';
        try {
          const form = new FormData();
          form.append('file', blob, 'test.webm');
          const res = await fetch('/api/stt/transcribe', { method: 'POST', body: form });
          const data = (await res.json()) as { text?: string; error?: string };
          if (!res.ok) throw new Error(data.error || 'Transcription failed');
          if (resultEl) resultEl.textContent = data.text?.trim() || '(no speech detected)';
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Transcription failed';
          if (resultEl) resultEl.textContent = message;
        }
      })();
    };
    if (testBtn) {
      testBtn.textContent = 'Stop recording';
      testBtn.disabled = false;
    }
    micRecorder.start();
    setTimeout(() => {
      if (micRecorder?.state === 'recording') micRecorder.stop();
    }, 5000);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Microphone access denied';
    if (resultEl) resultEl.textContent = message;
    if (testBtn) testBtn.disabled = false;
  }
}

function mountSttPanel(panel: HTMLElement): void {
  panel.append(
    el('h3', undefined, 'Speech-to-text'),
    el('p', 'models-lead', 'Whisper models via local Transformers pipeline or external API.'),
    el('p', 'models-voice-backend-summary', ''),
  );
  const summary = panel.querySelector('.models-voice-backend-summary');
  if (summary) summary.id = 'modelsVoiceSttBackendSummary';

  const catalogMount = el('div', 'models-voice-catalog-list');
  catalogMount.id = 'modelsVoiceSttCatalog';
  panel.appendChild(catalogMount);

  panel.appendChild(renderInstalledList());

  const settingsShell = el('div', 'models-voice-settings-shell');
  settingsShell.id = 'modelsVoiceSttSettings';
  panel.appendChild(settingsShell);

  const actions = el('div', 'models-voice-settings-actions');
  const saveBtn = el('button', 'models-inline-btn is-primary', 'Save STT settings');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void saveSttSettings();
  });
  actions.appendChild(saveBtn);

  const testBtn = el('button', 'models-inline-btn', 'Test mic (5s)');
  testBtn.type = 'button';
  testBtn.id = 'modelsVoiceSttTestMic';
  testBtn.addEventListener('click', () => {
    void runMicTest();
  });
  actions.appendChild(testBtn);
  panel.appendChild(actions);

  const resultEl = el('p', 'field-hint', '');
  resultEl.id = 'modelsVoiceSttTestResult';
  panel.appendChild(resultEl);
}

function renderTtsCatalogRow(entry: (typeof TTS_CATALOG)[number]): HTMLElement {
  const row = el('article', 'models-voice-catalog-row');
  const fit = hardware ? analyzeTtsFit(entry, hardware) : null;
  const head = el('div', 'models-voice-catalog-row__head');
  head.append(el('span', 'models-voice-catalog-row__label', entry.label));
  if (fit) {
    head.append(
      el('span', `models-fit-badge ${VOICE_FIT_BADGE_CLASS[fit.fitLevel]}`, fit.label),
    );
  } else {
    head.append(el('span', 'models-fit-badge', `~${entry.estVramGb} GB VRAM`));
  }
  row.appendChild(head);
  row.appendChild(
    el('p', 'models-voice-catalog-row__meta', `${entry.modelId} · ${entry.params}`),
  );

  const installed = isModelInstalled(entry.modelId, 'tts');
  const activeJob = [...activeDownloads.values()].find(
    (j) => j.kind === 'tts' && j.modelId === entry.modelId && (j.status === 'queued' || j.status === 'running'),
  );

  if (activeJob) {
    ensureTtsDownloadSubscription(activeJob);
    row.appendChild(renderDownloadProgress(activeJob));
    const cancelBtn = el('button', 'models-inline-btn', 'Cancel');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      void cancelVoiceDownload(activeJob.id).then(() => refreshVoicePanelUi());
    });
    row.appendChild(cancelBtn);
  } else {
    const downloadBtn = el('button', 'models-inline-btn', installed ? 'Installed' : 'Download');
    downloadBtn.type = 'button';
    downloadBtn.disabled = installed;
    downloadBtn.addEventListener('click', () => {
      void (async () => {
        try {
          const job = await downloadVoiceModel(entry.modelId, 'tts');
          activeDownloads.set(job.id, job);
          ensureTtsDownloadSubscription(job);
          await refreshVoicePanelUi();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Download failed';
          setStatus('err', message);
        }
      })();
    });
    row.appendChild(downloadBtn);
  }

  return row;
}

function renderTtsInstalledList(): HTMLElement {
  const section = el('section', 'models-voice-installed models-voice-installed--tts');
  section.appendChild(el('h4', undefined, 'Installed TTS models'));
  const list = el('div', 'models-voice-installed-list');
  const rows = (installedManifest?.tts ?? []).filter((row) => row.mode !== 'tokenizer');
  if (!rows.length) {
    list.appendChild(el('p', 'field-hint', 'No Qwen3-TTS models downloaded yet.'));
  } else {
    for (const row of rows) {
      const item = el('article', 'models-voice-installed-row');
      const head = el('div', 'models-voice-installed-row__head');
      head.append(el('span', 'models-installed-name', row.modelId));
      if (row.sizeBytes) head.append(el('span', 'models-muted', formatBytes(row.sizeBytes)));
      item.appendChild(head);
      const actions = el('div', 'models-installed-actions');
      const useBtn = el('button', 'models-inline-btn', 'Use');
      useBtn.type = 'button';
      useBtn.addEventListener('click', () => {
        void applyTtsModelSelection(row.modelId);
      });
      const delBtn = el('button', 'models-inline-btn', 'Delete');
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => {
        void deleteVoiceModel('tts', row.modelId).then(() => refreshInstalledManifest());
      });
      actions.append(useBtn, delBtn);
      item.appendChild(actions);
      list.appendChild(item);
    }
  }
  section.appendChild(list);
  return section;
}

async function applyTtsModelSelection(modelId: string): Promise<void> {
  const entry = findTtsCatalogEntry(modelId);
  const current = voiceConfig ?? (await loadVoiceMeta());
  const mode: VoiceConfig['tts']['local']['mode'] =
    entry?.mode === 'voice_design' || entry?.mode === 'voice_clone'
      ? entry.mode
      : 'custom_voice';
  const local = {
    ...current.tts.local,
    modelId,
    mode,
    ...(entry?.recommendedDefaults ?? {}),
    generation: {
      ...current.tts.local.generation,
      ...(entry?.recommendedDefaults?.generation ?? {}),
    },
  } satisfies VoiceTtsLocalConfig;
  const saved = await saveVoiceMeta({
    tts: { backend: 'local', local },
  });
  if (saved) {
    voiceConfig = saved;
    ttsBackend = 'local';
    await renderTtsSettingsSection();
    setStatus('ok', `TTS model set to ${modelId}`);
    await refreshActiveBackendSummary();
  }
}

async function renderTtsSettingsSection(): Promise<void> {
  const shell = document.getElementById('modelsVoiceTtsSettings');
  if (!shell || !voiceConfig) return;
  try {
    clonePrompts = await listClonePrompts();
  } catch {
    clonePrompts = [];
  }
  const catalogEntry = findTtsCatalogEntry(voiceConfig.tts.local.modelId);
  renderTtsSettingsForm({
    mount: shell,
    config: voiceConfig,
    catalogEntry,
    clonePrompts: clonePrompts.map((p) => ({ id: p.id, label: p.label })),
    onBackendChange: (backend) => {
      ttsBackend = backend;
      setTtsBackendUi(backend);
    },
  });
  fillTtsBrowserPanel(voiceConfig);
  await fillProviderSelect(
    document.getElementById('voiceTtsProviderId') as HTMLSelectElement,
    voiceConfig.tts.provider.providerId,
  );
  fillTtsProviderPanel(voiceConfig);
}

async function saveTtsSettings(): Promise<void> {
  if (!voiceConfig) voiceConfig = await loadVoiceMeta();
  let local = readTtsLocalFromForm(voiceConfig.tts.local);
  const refUpload = getTtsRefAudioUpload();
  if (refUpload) {
    try {
      const ref = await uploadRefAudio(refUpload);
      local = { ...local, voiceClone: { ...local.voiceClone, refAudioPath: ref.path } };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reference upload failed';
      setStatus('err', message);
      return;
    }
  }
  const provider = readTtsProviderFromForm(voiceConfig);
  const browser = readTtsBrowserFromForm(voiceConfig);
  const streaming =
    (document.getElementById('voiceTtsStreaming') as HTMLInputElement | null)?.checked ??
    voiceConfig.tts.streaming;
  const saved = await saveVoiceMeta({
    tts: {
      enabled: true,
      backend: ttsBackend,
      streaming,
      local,
      provider,
      browser,
    },
  });
  if (!saved) {
    setStatus('err', 'Could not save TTS settings. Use npm start.');
    return;
  }
  voiceConfig = saved;
  setStatus('ok', 'TTS settings saved');
  await refreshActiveBackendSummary();
}

let ttsTestAudio: HTMLAudioElement | null = null;

async function runTtsVoiceTest(): Promise<void> {
  const resultEl = document.getElementById('modelsVoiceTtsTestResult');
  const sample =
    (document.getElementById('modelsVoiceTtsTestText') as HTMLInputElement | null)?.value?.trim() ||
    'Hello from Minnow voice.';
  if (resultEl) resultEl.textContent = 'Synthesizing…';

  try {
    if (ttsBackend === 'browser') {
      const { speakWithBrowser } = await import('../voice-controls');
      const browser = readTtsBrowserFromForm(voiceConfig ?? (await loadVoiceMeta()));
      speakWithBrowser(sample, browser.voiceUri, browser.rate, browser.pitch, browser.volume);
      if (resultEl) resultEl.textContent = 'Playing via browser speechSynthesis.';
      return;
    }

    await saveTtsSettings();
    const blob = await synthesizeSpeech(sample);
    if (ttsTestAudio) {
      ttsTestAudio.pause();
      ttsTestAudio.src = '';
    }
    const url = URL.createObjectURL(blob);
    ttsTestAudio = new Audio(url);
    const voiceMeta = voiceConfig ?? (await loadVoiceMeta());
    const sinkable = ttsTestAudio as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (voiceMeta.audio.outputDeviceId && typeof sinkable.setSinkId === 'function') {
      try {
        await sinkable.setSinkId(voiceMeta.audio.outputDeviceId);
      } catch {
        /* ignore */
      }
    }
    ttsTestAudio.onended = () => {
      URL.revokeObjectURL(url);
      if (resultEl) resultEl.textContent = 'Playback finished.';
    };
    await ttsTestAudio.play();
    if (resultEl) resultEl.textContent = 'Playing synthesized sample…';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TTS test failed';
    if (resultEl) resultEl.textContent = message;
  }
}

function mountTtsPanel(panel: HTMLElement): void {
  panel.append(
    el('h3', undefined, 'Text-to-speech'),
    el('p', 'models-lead', 'Qwen3-TTS local models, provider API, or browser fallback.'),
    el('p', 'models-voice-backend-summary', ''),
  );
  const summary = panel.querySelector('.models-voice-backend-summary');
  if (summary) summary.id = 'modelsVoiceTtsBackendSummary';

  const catalogMount = el('div', 'models-voice-catalog-list');
  catalogMount.id = 'modelsVoiceTtsCatalog';
  panel.appendChild(catalogMount);

  const installedPlaceholder = el('div');
  installedPlaceholder.id = 'modelsVoiceTtsInstalledMount';
  panel.appendChild(installedPlaceholder);

  const settingsShell = el('div', 'models-voice-settings-shell');
  settingsShell.id = 'modelsVoiceTtsSettings';
  panel.appendChild(settingsShell);

  const actions = el('div', 'models-voice-settings-actions');
  const saveBtn = el('button', 'models-inline-btn is-primary', 'Save TTS settings');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void saveTtsSettings();
  });
  actions.appendChild(saveBtn);

  const testInput = el('input', 'models-voice-field__input');
  testInput.type = 'text';
  testInput.id = 'modelsVoiceTtsTestText';
  testInput.value = 'Hello from Minnow voice.';
  testInput.placeholder = 'Sample text for test voice';
  actions.appendChild(testInput);

  const testBtn = el('button', 'models-inline-btn', 'Test voice');
  testBtn.type = 'button';
  testBtn.id = 'modelsVoiceTtsTestBtn';
  testBtn.addEventListener('click', () => {
    void runTtsVoiceTest();
  });
  actions.appendChild(testBtn);
  panel.appendChild(actions);

  const resultEl = el('p', 'field-hint', '');
  resultEl.id = 'modelsVoiceTtsTestResult';
  panel.appendChild(resultEl);
}

async function refreshInstalledManifest(): Promise<void> {
  try {
    installedManifest = await listInstalledVoiceModels();
  } catch {
    installedManifest = { version: 1, stt: [], tts: [] };
  }
  await refreshVoicePanelUi();
}

async function refreshVoicePanelUi(): Promise<void> {
  const sttCatalogMount = document.getElementById('modelsVoiceSttCatalog');
  if (sttCatalogMount) {
    sttCatalogMount.replaceChildren();
    for (const entry of STT_CATALOG) {
      sttCatalogMount.appendChild(renderSttCatalogRow(entry));
    }
    const sttInstalled = document.querySelector('.models-voice-installed:not(.models-voice-installed--tts)');
    if (sttInstalled?.parentElement) {
      sttInstalled.replaceWith(renderInstalledList());
    }
  }

  const ttsCatalogMount = document.getElementById('modelsVoiceTtsCatalog');
  if (ttsCatalogMount) {
    ttsCatalogMount.replaceChildren();
    for (const entry of TTS_CATALOG) {
      if (entry.mode === 'tokenizer') continue;
      ttsCatalogMount.appendChild(renderTtsCatalogRow(entry));
    }
    const ttsInstalledMount = document.getElementById('modelsVoiceTtsInstalledMount');
    if (ttsInstalledMount) {
      ttsInstalledMount.replaceChildren(renderTtsInstalledList());
    }
  }
}

async function refreshSttPanelUi(): Promise<void> {
  await refreshVoicePanelUi();
}

async function refreshActiveBackendSummary(): Promise<void> {
  const config = voiceConfig ?? (await loadVoiceMeta());
  voiceConfig = config;
  sttBackend = config.stt.backend;
  ttsBackend = config.tts.backend;
  const sttSummary = document.getElementById('modelsVoiceSttBackendSummary');
  const ttsSummary = document.getElementById('modelsVoiceTtsBackendSummary');
  if (sttSummary) {
    sttSummary.textContent =
      config.stt.backend === 'local'
        ? `Local · ${config.stt.local.modelId}`
        : `Provider · ${config.stt.provider.providerId || 'not configured'}`;
  }
  if (ttsSummary) {
    ttsSummary.textContent =
      config.tts.backend === 'local'
        ? `Local · ${config.tts.local.modelId}`
        : config.tts.backend === 'browser'
          ? 'Browser (speechSynthesis)'
          : `Provider · ${config.tts.provider.providerId || 'not configured'}`;
  }
}

/** Mount Models → Voice panel on first activation. */
export function mountVoicePanel(): void {
  const body = document.getElementById('modelsVoiceBody');
  if (!body || mounted) return;
  mounted = true;

  body.replaceChildren();
  renderRuntimeCard(body);

  const subnav = el('nav', 'models-voice-subnav');
  subnav.setAttribute('aria-label', 'Voice STT and TTS');
  for (const id of ['stt', 'tts'] as const) {
    const btn = el('button', undefined, id === 'stt' ? 'STT' : 'TTS');
    btn.type = 'button';
    btn.dataset.voiceSubnav = id;
    btn.addEventListener('click', () => setActiveSubSection(id));
    subnav.appendChild(btn);
  }
  body.appendChild(subnav);

  const panels = el('div', 'models-voice-panels');
  const sttPanel = el('section', 'models-voice-panel is-active');
  sttPanel.id = 'modelsVoiceSttPanel';
  mountSttPanel(sttPanel);
  panels.appendChild(sttPanel);

  const ttsPanel = el('section', 'models-voice-panel');
  ttsPanel.id = 'modelsVoiceTtsPanel';
  mountTtsPanel(ttsPanel);
  panels.appendChild(ttsPanel);

  body.appendChild(panels);
  setActiveSubSection(activeSub);

  void (async () => {
    try {
      hardware = await fetchHardware();
    } catch {
      hardware = null;
    }
    voiceConfig = await loadVoiceMeta();
    sttBackend = voiceConfig.stt.backend;
    ttsBackend = voiceConfig.tts.backend;
    renderSttSettingsSection();
    await renderTtsSettingsSection();
    await Promise.all([
      refreshActiveBackendSummary(),
      refreshRuntimeStatus(),
      refreshInstalledManifest(),
    ]);
  })();
}

/** Re-render voice panel when section is re-activated. */
export async function refreshVoicePanel(): Promise<void> {
  if (!mounted) {
    mountVoicePanel();
    return;
  }
  voiceConfig = await loadVoiceMeta();
  sttBackend = voiceConfig.stt.backend;
  ttsBackend = voiceConfig.tts.backend;
  renderSttSettingsSection();
  await renderTtsSettingsSection();
  await Promise.all([
    refreshActiveBackendSummary(),
    refreshRuntimeStatus(),
    refreshInstalledManifest(),
  ]);
}
