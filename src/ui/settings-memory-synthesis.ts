/**
 * Settings → Memory: synthesis cadence and enable toggle.
 */

import {
  fetchSynthesisConfig,
  saveSynthesisConfig,
  type SynthesisConfig,
} from '../synthesis/client';

type StatusFn = (kind: 'ok' | 'err' | 'spin', message: string) => void;

let bindingsDone = false;

function formatThrottleHint(pairs: number): string {
  if (pairs <= 1) {
    return 'Runs after every completed user+assistant turn.';
  }
  return `Runs after every ${pairs} completed user+assistant turns.`;
}

/**
 * Wire synthesis settings controls and refresh values from the server.
 */
export function mountMemorySynthesisSettingsPanel(
  container: HTMLElement,
  setStatus: StatusFn,
): void {
  if (!bindingsDone) {
    bindingsDone = true;
    bindSynthesisSettingsControls(setStatus);
  }

  void refreshMemorySynthesisSettingsPanel(container);
}

function bindSynthesisSettingsControls(setStatus: StatusFn): void {
  const enabledEl = document.getElementById(
    'settingsMemorySynthesisEnabled',
  ) as HTMLInputElement | null;
  const throttleEl = document.getElementById(
    'settingsMemorySynthesisThrottle',
  ) as HTMLInputElement | null;
  const saveBtn = document.getElementById('settingsMemorySynthesisSave');

  throttleEl?.addEventListener('input', () => {
    updateThrottleHint(throttleEl);
  });

  saveBtn?.addEventListener('click', () => {
    void (async () => {
      const throttle = Number(throttleEl?.value ?? 4);
      if (!Number.isFinite(throttle) || throttle < 1) {
        setStatus('err', 'Throttle must be at least 1 message pair');
        return;
      }

      const saved = await saveSynthesisConfig({
        enabled: enabledEl?.checked === true,
        throttleMessagePairs: Math.round(throttle),
      });
      if (!saved) {
        setStatus('err', 'Could not save synthesis settings. Use npm start.');
        return;
      }
      setStatus('ok', 'Synthesis settings saved');
      const panel = document.getElementById('settingsMemorySynthesisPanel');
      if (panel) await refreshMemorySynthesisSettingsPanel(panel);
    })();
  });
}

function updateThrottleHint(throttleEl: HTMLInputElement | null): void {
  const hintEl = document.getElementById('settingsMemorySynthesisThrottleHint');
  if (!hintEl || !throttleEl) return;
  const pairs = Math.max(1, Math.round(Number(throttleEl.value) || 1));
  hintEl.textContent = formatThrottleHint(pairs);
}

async function refreshMemorySynthesisSettingsPanel(
  container: HTMLElement,
): Promise<void> {
  const offlineEl = document.getElementById('settingsMemorySynthesisOffline');
  const enabledEl = document.getElementById(
    'settingsMemorySynthesisEnabled',
  ) as HTMLInputElement | null;
  const throttleEl = document.getElementById(
    'settingsMemorySynthesisThrottle',
  ) as HTMLInputElement | null;
  const saveBtn = document.getElementById('settingsMemorySynthesisSave');

  const config: SynthesisConfig | null = await fetchSynthesisConfig();

  if (!config) {
    container.classList.add('settings-memory-synthesis--offline');
    offlineEl?.classList.remove('hidden');
    if (enabledEl) enabledEl.disabled = true;
    if (throttleEl) throttleEl.disabled = true;
    if (saveBtn) saveBtn.setAttribute('disabled', 'true');
    return;
  }

  container.classList.remove('settings-memory-synthesis--offline');
  offlineEl?.classList.add('hidden');
  if (enabledEl) {
    enabledEl.disabled = false;
    if (!enabledEl.matches(':focus')) enabledEl.checked = config.enabled !== false;
  }
  if (throttleEl) {
    throttleEl.disabled = false;
    if (!throttleEl.matches(':focus')) {
      throttleEl.value = String(config.throttleMessagePairs ?? 4);
    }
    updateThrottleHint(throttleEl);
  }
  if (saveBtn) saveBtn.removeAttribute('disabled');
}
