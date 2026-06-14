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
    const tab = document.querySelector(`[data-voice-subnav="${id}"]`);
    const selected = id === sub;
    tab?.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab?.classList.toggle('is-active', selected);
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

function runtimeHealthDotClass(health: VoiceRuntimeHealth): string {
  switch (health) {
    case 'ready':
      return 'models-voice-runtime__dot--ready';
    case 'installing':
    case 'starting':
      return 'models-voice-runtime__dot--busy';
    case 'error':
      return 'models-voice-runtime__dot--error';
    case 'stopped':
      return 'models-voice-runtime__dot--stopped';
    default:
      return 'models-voice-runtime__dot--idle';
  }
}

function updateRuntimeCardUi(): void {
  const card = document.querySelector('.models-voice-runtime');
  if (!card || !runtimeStatus) return;

  const dotEl = card.querySelector('.models-voice-runtime__dot');
  const statusEl = card.querySelector('.models-voice-runtime__status');
  const detailEl = card.querySelector('.models-voice-runtime__detail');
  const progressEl = card.querySelector('.models-voice-runtime__progress');
  const installBtn = card.querySelector('[data-voice-action="install"]') as HTMLButtonElement | null;
  const repairBtn = card.querySelector('[data-voice-action="repair"]') as HTMLButtonElement | null;
  const startBtn = card.querySelector('[data-voice-action="start"]') as HTMLButtonElement | null;
  const stopBtn = card.querySelector('[data-voice-action="stop"]') as HTMLButtonElement | null;

  if (dotEl) {
    dotEl.className = `models-voice-runtime__dot ${runtimeHealthDotClass(runtimeStatus.health)}`;
  }

  if (statusEl) {
    statusEl.textContent = healthLabel(runtimeStatus.health);
  }

  if (detailEl) {
    const parts: string[] = [];
    parts.push(runtimeStatus.cudaAvailable ? 'CUDA' : 'CPU');
    if (runtimeStatus.running && runtimeStatus.port) {
      parts.push(`127.0.0.1:${runtimeStatus.port}`);
    }
    if (runtimeStatus.installJob?.message && runtimeStatus.health === 'installing') {
      parts.push(runtimeStatus.installJob.message);
    }
    detailEl.textContent = parts.join(' · ');
  }

  if (progressEl) {
    const job = runtimeStatus.installJob;
    const bar = progressEl.querySelector('.models-download-progress__bar') as HTMLElement | null;
    const label = progressEl.querySelector('.models-download-progress__label');
    if (job?.phase === 'installing') {
      if (bar) bar.style.width = `${job.percent}%`;
      if (label) label.textContent = `${job.percent}% · ${job.message}`;
      progressEl.classList.remove('is-hidden');
    } else if (job?.phase === 'failed' && job.error) {
      if (bar) bar.style.width = '0%';
      if (label) label.textContent = job.error;
      progressEl.classList.remove('is-hidden');
    } else {
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
  const card = el('section', 'models-voice-runtime');
  card.dataset.settingsSearchKey = 'models.voice.runtime';
  card.setAttribute('aria-label', 'Python voice runtime');

  const main = el('div', 'models-voice-runtime__main');
  const identity = el('div', 'models-voice-runtime__identity');
  identity.append(
    el('span', 'models-voice-runtime__dot models-voice-runtime__dot--idle'),
    el('span', 'models-voice-runtime__title', 'Python voice runtime'),
    el('span', 'models-voice-runtime__status', 'Not installed'),
  );
  main.appendChild(identity);
  main.appendChild(
    el('span', 'models-voice-runtime__detail', 'Whisper STT and Qwen3-TTS worker'),
  );

  const progressWrap = el('div', 'models-voice-runtime__progress is-hidden');
  const progress = el('div', 'models-download-progress');
  const bar = el('div', 'models-download-progress__bar');
  bar.style.width = '0%';
  progress.append(bar, el('span', 'models-download-progress__label', ''));
  progressWrap.appendChild(progress);
  main.appendChild(progressWrap);
  card.appendChild(main);

  const actions = el('div', 'models-voice-runtime__actions');
  const installBtn = el('button', 'models-inline-btn is-primary', 'Install');
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

  const startBtn = el('button', 'models-inline-btn', 'Start');
  startBtn.type = 'button';
  startBtn.dataset.voiceAction = 'start';
  startBtn.addEventListener('click', () => {
    void (async () => {
      await startVoiceWorker();
      await refreshRuntimeStatus();
    })();
  });
  actions.appendChild(startBtn);

  const stopBtn = el('button', 'models-inline-btn', 'Stop');
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

function renderCatalogRowActions(
  row: HTMLElement,
  entry: { modelId: string },
  kind: 'stt' | 'tts',
  installed: boolean,
): void {
  const actions = el('div', 'models-voice-row__actions');
  const activeJob = [...activeDownloads.values()].find(
    (j) =>
      j.modelId === entry.modelId &&
      j.kind === kind &&
      (j.status === 'queued' || j.status === 'running'),
  );

  if (activeJob) {
    ensureDownloadSubscription(activeJob);
    const main = row.querySelector('.models-voice-row__main');
    if (main) main.appendChild(renderDownloadProgress(activeJob));
    const cancelBtn = el('button', 'models-inline-btn', 'Cancel');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      void cancelVoiceDownload(activeJob.id).then(() => refreshVoicePanelUi());
    });
    actions.appendChild(cancelBtn);
  } else {
    const downloadBtn = el('button', 'models-inline-btn', installed ? 'Installed' : 'Download');
    downloadBtn.type = 'button';
    downloadBtn.disabled = installed;
    if (installed) downloadBtn.classList.add('is-installed');
    downloadBtn.addEventListener('click', () => {
      void (async () => {
        try {
          const job = await downloadVoiceModel(entry.modelId, kind);
          activeDownloads.set(job.id, job);
          ensureDownloadSubscription(job);
          await refreshVoicePanelUi();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Download failed';
          setStatus('err', message);
        }
      })();
    });
    actions.appendChild(downloadBtn);
  }
  row.appendChild(actions);
}

function renderSttCatalogRow(entry: (typeof STT_CATALOG)[number]): HTMLElement {
  const row = el('article', 'models-voice-row');
  const fit = hardware ? analyzeSttFit(entry, hardware) : null;
  const main = el('div', 'models-voice-row__main');
  const head = el('div', 'models-voice-row__head');
  head.append(el('span', 'models-voice-row__name', entry.label));
  if (fit) {
    head.append(
      el('span', `models-fit-badge ${VOICE_FIT_BADGE_CLASS[fit.fitLevel]}`, fit.label),
    );
  } else {
    head.append(el('span', 'models-fit-badge', `~${entry.estVramGb} GB VRAM`));
  }
  main.appendChild(head);
  main.appendChild(
    el('p', 'models-voice-row__meta', `${entry.modelId} · ${entry.params}`),
  );
  row.appendChild(main);

  const installed = isModelInstalled(entry.modelId, 'stt');
  renderCatalogRowActions(row, entry, 'stt', installed);
  return row;
}

function renderInstalledList(): HTMLElement {
  const section = el('section', 'models-voice-zone models-voice-installed');
  section.appendChild(el('h4', 'models-section-subtitle', 'Installed'));
  const list = el('div', 'models-voice-list models-voice-list--installed');
  const rows = installedManifest?.stt ?? [];
  if (!rows.length) {
    list.appendChild(el('p', 'models-voice-empty', 'No Whisper models downloaded yet.'));
  } else {
    for (const row of rows) {
      const item = el('article', 'models-voice-row models-voice-row--installed');
      const main = el('div', 'models-voice-row__main');
      const head = el('div', 'models-voice-row__head');
      head.append(el('span', 'models-voice-row__name', row.modelId));
      if (row.sizeBytes) {
        head.append(el('span', 'models-fit-badge', formatBytes(row.sizeBytes)));
      }
      main.appendChild(head);
      item.appendChild(main);

      const actions = el('div', 'models-voice-row__actions');
      const useBtn = el('button', 'models-inline-btn is-primary', 'Use');
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
  const header = el('header', 'models-voice-panel__header');
  header.append(
    el('h3', 'models-voice-panel__title', 'Speech-to-text'),
    el('span', 'models-voice-active-chip', ''),
  );
  const chip = header.querySelector('.models-voice-active-chip');
  if (chip) chip.id = 'modelsVoiceSttBackendSummary';
  panel.appendChild(header);

  const catalogZone = el('section', 'models-voice-zone');
  catalogZone.appendChild(el('h4', 'models-section-subtitle', 'Catalog'));
  const catalogMount = el('div', 'models-voice-list');
  catalogMount.id = 'modelsVoiceSttCatalog';
  catalogZone.appendChild(catalogMount);
  panel.appendChild(catalogZone);

  panel.appendChild(renderInstalledList());

  const configZone = el('section', 'models-voice-zone models-voice-zone--config');
  configZone.appendChild(el('h4', 'models-section-subtitle', 'Configuration'));
  const settingsShell = el('div', 'models-voice-settings-shell');
  settingsShell.id = 'modelsVoiceSttSettings';
  configZone.appendChild(settingsShell);
  panel.appendChild(configZone);

  const benchZone = el('section', 'models-voice-zone models-voice-zone--bench');
  benchZone.appendChild(el('h4', 'models-section-subtitle', 'Test bench'));
  const actions = el('div', 'models-voice-bench');
  const saveBtn = el('button', 'models-inline-btn is-primary', 'Save settings');
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
  benchZone.appendChild(actions);

  const resultEl = el('p', 'models-voice-bench__result field-hint', '');
  resultEl.id = 'modelsVoiceSttTestResult';
  benchZone.appendChild(resultEl);
  panel.appendChild(benchZone);
}

function renderTtsCatalogRow(entry: (typeof TTS_CATALOG)[number]): HTMLElement {
  const row = el('article', 'models-voice-row');
  const fit = hardware ? analyzeTtsFit(entry, hardware) : null;
  const main = el('div', 'models-voice-row__main');
  const head = el('div', 'models-voice-row__head');
  head.append(el('span', 'models-voice-row__name', entry.label));
  if (fit) {
    head.append(
      el('span', `models-fit-badge ${VOICE_FIT_BADGE_CLASS[fit.fitLevel]}`, fit.label),
    );
  } else {
    head.append(el('span', 'models-fit-badge', `~${entry.estVramGb} GB VRAM`));
  }
  main.appendChild(head);
  main.appendChild(
    el('p', 'models-voice-row__meta', `${entry.modelId} · ${entry.params}`),
  );
  row.appendChild(main);

  const installed = isModelInstalled(entry.modelId, 'tts');
  renderCatalogRowActions(row, entry, 'tts', installed);
  return row;
}

function renderTtsInstalledList(): HTMLElement {
  const section = el('section', 'models-voice-zone models-voice-installed models-voice-installed--tts');
  section.appendChild(el('h4', 'models-section-subtitle', 'Installed'));
  const list = el('div', 'models-voice-list models-voice-list--installed');
  const rows = (installedManifest?.tts ?? []).filter((row) => row.mode !== 'tokenizer');
  if (!rows.length) {
    list.appendChild(el('p', 'models-voice-empty', 'No Qwen3-TTS models downloaded yet.'));
  } else {
    for (const row of rows) {
      const item = el('article', 'models-voice-row models-voice-row--installed');
      const main = el('div', 'models-voice-row__main');
      const head = el('div', 'models-voice-row__head');
      head.append(el('span', 'models-voice-row__name', row.modelId));
      if (row.sizeBytes) {
        head.append(el('span', 'models-fit-badge', formatBytes(row.sizeBytes)));
      }
      main.appendChild(head);
      item.appendChild(main);

      const actions = el('div', 'models-voice-row__actions');
      const useBtn = el('button', 'models-inline-btn is-primary', 'Use');
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
  const header = el('header', 'models-voice-panel__header');
  header.append(
    el('h3', 'models-voice-panel__title', 'Text-to-speech'),
    el('span', 'models-voice-active-chip', ''),
  );
  const chip = header.querySelector('.models-voice-active-chip');
  if (chip) chip.id = 'modelsVoiceTtsBackendSummary';
  panel.appendChild(header);

  const catalogZone = el('section', 'models-voice-zone');
  catalogZone.appendChild(el('h4', 'models-section-subtitle', 'Catalog'));
  const catalogMount = el('div', 'models-voice-list');
  catalogMount.id = 'modelsVoiceTtsCatalog';
  catalogZone.appendChild(catalogMount);
  panel.appendChild(catalogZone);

  const installedPlaceholder = el('div');
  installedPlaceholder.id = 'modelsVoiceTtsInstalledMount';
  panel.appendChild(installedPlaceholder);

  const configZone = el('section', 'models-voice-zone models-voice-zone--config');
  configZone.appendChild(el('h4', 'models-section-subtitle', 'Configuration'));
  const settingsShell = el('div', 'models-voice-settings-shell');
  settingsShell.id = 'modelsVoiceTtsSettings';
  configZone.appendChild(settingsShell);
  panel.appendChild(configZone);

  const benchZone = el('section', 'models-voice-zone models-voice-zone--bench');
  benchZone.appendChild(el('h4', 'models-section-subtitle', 'Test bench'));
  const actions = el('div', 'models-voice-bench');
  const saveBtn = el('button', 'models-inline-btn is-primary', 'Save settings');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => {
    void saveTtsSettings();
  });
  actions.appendChild(saveBtn);

  const testInput = el('input', 'models-voice-bench__input');
  testInput.type = 'text';
  testInput.id = 'modelsVoiceTtsTestText';
  testInput.value = 'Hello from Minnow voice.';
  testInput.placeholder = 'Sample phrase';
  testInput.setAttribute('aria-label', 'Sample text for voice test');
  actions.appendChild(testInput);

  const testBtn = el('button', 'models-inline-btn', 'Test voice');
  testBtn.type = 'button';
  testBtn.id = 'modelsVoiceTtsTestBtn';
  testBtn.addEventListener('click', () => {
    void runTtsVoiceTest();
  });
  actions.appendChild(testBtn);
  benchZone.appendChild(actions);

  const resultEl = el('p', 'models-voice-bench__result field-hint', '');
  resultEl.id = 'modelsVoiceTtsTestResult';
  benchZone.appendChild(resultEl);
  panel.appendChild(benchZone);
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

  const subnav = el('nav', 'models-voice-tabs');
  subnav.setAttribute('role', 'tablist');
  subnav.setAttribute('aria-label', 'Voice STT and TTS');
  for (const id of ['stt', 'tts'] as const) {
    const btn = el('button', 'models-voice-tabs__tab', id === 'stt' ? 'Speech-to-text' : 'Text-to-speech');
    btn.type = 'button';
    btn.id = id === 'stt' ? 'modelsVoiceTabStt' : 'modelsVoiceTabTts';
    btn.role = 'tab';
    btn.dataset.voiceSubnav = id;
    btn.setAttribute('aria-controls', id === 'stt' ? 'modelsVoiceSttPanel' : 'modelsVoiceTtsPanel');
    btn.addEventListener('click', () => setActiveSubSection(id));
    subnav.appendChild(btn);
  }
  body.appendChild(subnav);

  const panels = el('div', 'models-voice-panels');
  const sttPanel = el('section', 'models-voice-panel is-active');
  sttPanel.id = 'modelsVoiceSttPanel';
  sttPanel.role = 'tabpanel';
  sttPanel.setAttribute('aria-labelledby', 'modelsVoiceTabStt');
  mountSttPanel(sttPanel);
  panels.appendChild(sttPanel);

  const ttsPanel = el('section', 'models-voice-panel');
  ttsPanel.id = 'modelsVoiceTtsPanel';
  ttsPanel.role = 'tabpanel';
  ttsPanel.setAttribute('aria-labelledby', 'modelsVoiceTabTts');
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
