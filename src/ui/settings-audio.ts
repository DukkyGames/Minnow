/**
 * Settings → Audio: input/output devices and capture constraints.
 */

import { detectConfigServer } from '../config/storage-mode';
import { loadVoiceMeta, saveVoiceMeta } from '../config/voice-meta';

type StatusFn = (kind: 'ok' | 'err' | 'spin', message: string) => void;

let bindingsDone = false;

/** Request mic permission so device labels are populated. */
async function primeAudioDeviceLabels(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // Permission denied — enumerateDevices may still return generic labels.
  }
}

async function populateDeviceSelect(
  select: HTMLSelectElement,
  kind: 'audioinput' | 'audiooutput',
  selectedId: string,
): Promise<void> {
  select.replaceChildren();
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent =
    kind === 'audioinput' ? 'System default microphone' : 'System default speaker';
  select.appendChild(defaultOpt);

  if (!navigator.mediaDevices?.enumerateDevices) return;

  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const device of devices) {
    if (device.kind !== kind) continue;
    const opt = document.createElement('option');
    opt.value = device.deviceId;
    opt.textContent =
      device.label ||
      `${kind === 'audioinput' ? 'Microphone' : 'Speaker'} (${device.deviceId.slice(0, 8)}…)`;
    select.appendChild(opt);
  }

  if (selectedId) select.value = selectedId;
}

async function saveAudioSettingsFromForm(): Promise<boolean> {
  const inputDeviceId =
    (document.getElementById('settingsAudioInputDevice') as HTMLSelectElement | null)?.value ??
    '';
  const outputDeviceId =
    (document.getElementById('settingsAudioOutputDevice') as HTMLSelectElement | null)?.value ??
    '';
  const echoCancellation =
    (document.getElementById('settingsAudioEchoCancellation') as HTMLInputElement | null)
      ?.checked ?? true;
  const noiseSuppression =
    (document.getElementById('settingsAudioNoiseSuppression') as HTMLInputElement | null)
      ?.checked ?? true;
  const autoGainControl =
    (document.getElementById('settingsAudioAutoGainControl') as HTMLInputElement | null)
      ?.checked ?? true;

  const saved = await saveVoiceMeta({
    audio: {
      inputDeviceId,
      outputDeviceId,
      echoCancellation,
      noiseSuppression,
      autoGainControl,
    },
  });
  return saved != null;
}

function bindAudioSettingsControls(setStatus: StatusFn): void {
  document.getElementById('settingsAudioSave')?.addEventListener('click', () => {
    void (async () => {
      const ok = await saveAudioSettingsFromForm();
      if (!ok) {
        setStatus('err', 'Could not save audio settings. Use npm start.');
        return;
      }
      setStatus('ok', 'Audio settings saved');
    })();
  });

  document.getElementById('settingsAudioRefreshDevices')?.addEventListener('click', () => {
    void (async () => {
      setStatus('spin', 'Refreshing devices…');
      await primeAudioDeviceLabels();
      const config = await loadVoiceMeta();
      const inputSelect = document.getElementById(
        'settingsAudioInputDevice',
      ) as HTMLSelectElement | null;
      const outputSelect = document.getElementById(
        'settingsAudioOutputDevice',
      ) as HTMLSelectElement | null;
      if (inputSelect) {
        await populateDeviceSelect(inputSelect, 'audioinput', config.audio.inputDeviceId);
      }
      if (outputSelect) {
        await populateDeviceSelect(outputSelect, 'audiooutput', config.audio.outputDeviceId);
      }
      setStatus('ok', 'Device list refreshed');
    })();
  });
}

async function refreshAudioSettingsPanel(container: HTMLElement): Promise<void> {
  const serverUp = await detectConfigServer();
  const offlineEl = document.getElementById('settingsAudioOffline');
  const fieldIds = [
    'settingsAudioInputDevice',
    'settingsAudioOutputDevice',
    'settingsAudioEchoCancellation',
    'settingsAudioNoiseSuppression',
    'settingsAudioAutoGainControl',
    'settingsAudioSave',
    'settingsAudioRefreshDevices',
  ];

  for (const id of fieldIds) {
    const field = document.getElementById(id) as HTMLInputElement | null;
    if (field) field.disabled = !serverUp;
  }

  if (!serverUp) {
    offlineEl?.classList.remove('hidden');
    container.classList.add('settings-audio--offline');
    return;
  }

  offlineEl?.classList.add('hidden');
  container.classList.remove('settings-audio--offline');

  await primeAudioDeviceLabels();
  const config = await loadVoiceMeta();

  const inputSelect = document.getElementById(
    'settingsAudioInputDevice',
  ) as HTMLSelectElement | null;
  const outputSelect = document.getElementById(
    'settingsAudioOutputDevice',
  ) as HTMLSelectElement | null;
  if (inputSelect) {
    await populateDeviceSelect(inputSelect, 'audioinput', config.audio.inputDeviceId);
  }
  if (outputSelect) {
    await populateDeviceSelect(outputSelect, 'audiooutput', config.audio.outputDeviceId);
  }

  const echoCb = document.getElementById(
    'settingsAudioEchoCancellation',
  ) as HTMLInputElement | null;
  const noiseCb = document.getElementById(
    'settingsAudioNoiseSuppression',
  ) as HTMLInputElement | null;
  const agcCb = document.getElementById(
    'settingsAudioAutoGainControl',
  ) as HTMLInputElement | null;
  if (echoCb) echoCb.checked = config.audio.echoCancellation;
  if (noiseCb) noiseCb.checked = config.audio.noiseSuppression;
  if (agcCb) agcCb.checked = config.audio.autoGainControl;
}

/** Wire audio settings panel controls. */
export function mountAudioSettingsPanel(
  container: HTMLElement,
  setStatus: StatusFn,
): void {
  if (!bindingsDone) {
    bindingsDone = true;
    bindAudioSettingsControls(setStatus);
  }
  void refreshAudioSettingsPanel(container);
}

/** Render Settings → Audio section. */
export async function renderAudioSettingsSection(setStatus: StatusFn): Promise<void> {
  const panel = document.getElementById('settingsAudioPanel');
  if (!panel) return;
  mountAudioSettingsPanel(panel, setStatus);
}
