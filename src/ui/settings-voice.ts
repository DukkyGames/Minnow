/**
 * Settings → Voice: STT/TTS provider configuration and test playback.
 */

import { loadVoiceMeta, saveVoiceMeta, type VoiceConfig } from '../config/voice-meta';
import { detectConfigServer } from '../config/storage-mode';
import { fillProviderSelect } from './settings-model-binding';
import {
  fetchSttStatus,
  fetchTtsStatus,
  speakWithBrowser,
  synthesizeSpeech,
} from './voice-controls';

type StatusFn = (kind: 'ok' | 'err' | 'spin', message: string) => void;

const TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
];

let bindingsDone = false;

/** Wire voice settings panel controls. */
export function mountVoiceSettingsPanel(
  container: HTMLElement,
  setStatus: StatusFn,
): void {
  if (!bindingsDone) {
    bindingsDone = true;
    bindVoiceSettingsControls(setStatus);
  }
  void refreshVoiceSettingsPanel(container);
}

function bindVoiceSettingsControls(setStatus: StatusFn): void {
  const saveBtn = document.getElementById('settingsVoiceSave');
  const testBtn = document.getElementById('settingsVoiceTestTts');

  saveBtn?.addEventListener('click', () => {
    void (async () => {
      const saved = await saveVoiceSettingsFromForm();
      if (!saved) {
        setStatus('err', 'Could not save voice settings. Use npm start.');
        return;
      }
      setStatus('ok', 'Voice settings saved');
      await Promise.all([fetchSttStatus(), fetchTtsStatus()]);
      const panel = document.getElementById('settingsVoicePanel');
      if (panel) await refreshVoiceSettingsPanel(panel);
    })();
  });

  testBtn?.addEventListener('click', () => {
    void (async () => {
      const phrase = 'Hello from Minnow.';
      const providerId =
        (document.getElementById('settingsVoiceTtsProvider') as HTMLSelectElement | null)
          ?.value ?? '';
      const voice =
        (document.getElementById('settingsVoiceTtsVoice') as HTMLSelectElement | null)
          ?.value ?? 'alloy';
      const speed = Number(
        (document.getElementById('settingsVoiceTtsSpeed') as HTMLInputElement | null)
          ?.value ?? 1,
      );
      setStatus('spin', 'Testing voice…');
      try {
        if (providerId === 'browser') {
          speakWithBrowser(phrase, voice, speed);
          return;
        }
        const blob = await synthesizeSpeech(phrase, { voice, speed });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setStatus('ok', 'Test playback finished');
        };
        await audio.play();
        setStatus('ok', 'Playing test phrase…');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Test failed';
        setStatus('err', message);
      }
    })();
  });
}

async function saveVoiceSettingsFromForm(): Promise<VoiceConfig | null> {
  const sttEnabled = (
    document.getElementById('settingsVoiceSttEnabled') as HTMLInputElement | null
  )?.checked;
  const ttsEnabled = (
    document.getElementById('settingsVoiceTtsEnabled') as HTMLInputElement | null
  )?.checked;
  const sttProvider = (
    document.getElementById('settingsVoiceSttProvider') as HTMLSelectElement | null
  )?.value;
  const ttsProvider = (
    document.getElementById('settingsVoiceTtsProvider') as HTMLSelectElement | null
  )?.value;
  const sttModel = (
    document.getElementById('settingsVoiceSttModel') as HTMLInputElement | null
  )?.value;
  const ttsModel = (
    document.getElementById('settingsVoiceTtsModel') as HTMLInputElement | null
  )?.value;
  const sttLanguage = (
    document.getElementById('settingsVoiceSttLanguage') as HTMLInputElement | null
  )?.value;
  const ttsVoice = (
    document.getElementById('settingsVoiceTtsVoice') as HTMLSelectElement | null
  )?.value;
  const ttsSpeed = Number(
    (document.getElementById('settingsVoiceTtsSpeed') as HTMLInputElement | null)?.value ??
      1,
  );
  const ttsFormat = (
    document.getElementById('settingsVoiceTtsFormat') as HTMLSelectElement | null
  )?.value;

  return saveVoiceMeta({
    stt: {
      enabled: sttEnabled === true,
      providerId: sttProvider ?? '',
      model: sttModel?.trim() || 'whisper-1',
      language: sttLanguage?.trim() || 'en',
    },
    tts: {
      enabled: ttsEnabled === true,
      providerId: ttsProvider ?? '',
      model: ttsModel?.trim() || 'tts-1',
      voice: ttsVoice ?? 'alloy',
      speed: Number.isFinite(ttsSpeed)
        ? Math.min(4, Math.max(0.25, ttsSpeed))
        : 1,
      format: ttsFormat ?? 'mp3',
    },
  });
}

async function refreshVoiceSettingsPanel(container: HTMLElement): Promise<void> {
  const serverUp = await detectConfigServer();
  const offlineEl = document.getElementById('settingsVoiceOffline');
  const errorEl = document.getElementById('settingsVoiceError');
  const fields = [
    'settingsVoiceSttEnabled',
    'settingsVoiceTtsEnabled',
    'settingsVoiceSttProvider',
    'settingsVoiceTtsProvider',
    'settingsVoiceSttModel',
    'settingsVoiceTtsModel',
    'settingsVoiceSttLanguage',
    'settingsVoiceTtsVoice',
    'settingsVoiceTtsSpeed',
    'settingsVoiceTtsFormat',
    'settingsVoiceSave',
    'settingsVoiceTestTts',
  ];

  for (const id of fields) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.disabled = !serverUp;
  }

  if (!serverUp) {
    offlineEl?.classList.remove('hidden');
    container.classList.add('settings-voice--offline');
    return;
  }

  offlineEl?.classList.add('hidden');
  container.classList.remove('settings-voice--offline');

  const config = await loadVoiceMeta();
  const sttProvider = document.getElementById(
    'settingsVoiceSttProvider',
  ) as HTMLSelectElement | null;
  const ttsProvider = document.getElementById(
    'settingsVoiceTtsProvider',
  ) as HTMLSelectElement | null;

  if (sttProvider) {
    await fillProviderSelect(sttProvider, config.stt.providerId, {
      includeEmptyOption: true,
    });
  }
  if (ttsProvider) {
    await fillProviderSelect(ttsProvider, config.tts.providerId, {
      includeEmptyOption: true,
    });
    const browserOpt = document.createElement('option');
    browserOpt.value = 'browser';
    browserOpt.textContent = 'Browser (offline)';
    ttsProvider.appendChild(browserOpt);
    if (config.tts.providerId === 'browser') {
      ttsProvider.value = 'browser';
    }
  }

  const sttEnabled = document.getElementById(
    'settingsVoiceSttEnabled',
  ) as HTMLInputElement | null;
  const ttsEnabled = document.getElementById(
    'settingsVoiceTtsEnabled',
  ) as HTMLInputElement | null;
  if (sttEnabled) sttEnabled.checked = config.stt.enabled;
  if (ttsEnabled) ttsEnabled.checked = config.tts.enabled;

  const sttModel = document.getElementById(
    'settingsVoiceSttModel',
  ) as HTMLInputElement | null;
  const ttsModel = document.getElementById(
    'settingsVoiceTtsModel',
  ) as HTMLInputElement | null;
  if (sttModel) sttModel.value = config.stt.model;
  if (ttsModel) ttsModel.value = config.tts.model;

  const sttLanguage = document.getElementById(
    'settingsVoiceSttLanguage',
  ) as HTMLInputElement | null;
  if (sttLanguage) sttLanguage.value = config.stt.language;

  const ttsVoice = document.getElementById(
    'settingsVoiceTtsVoice',
  ) as HTMLSelectElement | null;
  if (ttsVoice) {
    ttsVoice.replaceChildren();
    for (const voice of TTS_VOICES) {
      const opt = document.createElement('option');
      opt.value = voice;
      opt.textContent = voice;
      ttsVoice.appendChild(opt);
    }
    ttsVoice.value = config.tts.voice;
  }

  const ttsSpeed = document.getElementById(
    'settingsVoiceTtsSpeed',
  ) as HTMLInputElement | null;
  if (ttsSpeed) ttsSpeed.value = String(config.tts.speed);

  const ttsFormat = document.getElementById(
    'settingsVoiceTtsFormat',
  ) as HTMLSelectElement | null;
  if (ttsFormat) ttsFormat.value = config.tts.format;

  const [sttStatus, ttsStatus] = await Promise.all([
    fetchSttStatus(),
    fetchTtsStatus(),
  ]);
  if (errorEl) {
    const issues: string[] = [];
    if (config.stt.enabled && !sttStatus?.healthy) {
      issues.push('STT provider is missing or unreachable.');
    }
    if (
      config.tts.enabled &&
      config.tts.providerId &&
      config.tts.providerId !== 'browser' &&
      !ttsStatus?.healthy
    ) {
      issues.push('TTS provider is missing or unreachable.');
    }
    if (issues.length) {
      errorEl.textContent = issues.join(' ');
      errorEl.classList.remove('hidden');
    } else {
      errorEl.classList.add('hidden');
    }
  }
}

/** Render the voice settings section body. */
export async function renderVoiceSettingsSection(
  setStatus: StatusFn,
): Promise<void> {
  const panel = document.getElementById('settingsVoicePanel');
  if (!panel) return;
  mountVoiceSettingsPanel(panel, setStatus);
}
