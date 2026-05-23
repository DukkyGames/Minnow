/**
 * Compact provider + model picker for "Fork with different model…".
 */

import { fetchModels } from '../api/models';
import { listProviders } from '../providers/store';
import type { ForkOverrides } from '../chat/fork-from-run';

export interface ForkModelDialogResult {
  providerId: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
}

function readSamplerFromDom(): { temperature: number; maxTokens: number } {
  const tempEl = document.getElementById('temperature') as HTMLInputElement | null;
  const maxEl = document.getElementById('maxTokens') as HTMLInputElement | null;
  const temperature = tempEl ? parseFloat(tempEl.value) : 0.7;
  const maxTokens = maxEl ? parseInt(maxEl.value, 10) : 4096;
  return {
    temperature: Number.isFinite(temperature) ? temperature : 0.7,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : 4096,
  };
}

/** Modal dialog; resolves null when cancelled. */
export function openForkModelDialog(
  initial: ForkOverrides & { providerId?: string; modelId?: string },
): Promise<ForkModelDialogResult | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'fork-model-dialog__backdrop';
    backdrop.setAttribute('role', 'presentation');

    const panel = document.createElement('div');
    panel.className = 'fork-model-dialog';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'forkModelDialogTitle');

    const title = document.createElement('h2');
    title.id = 'forkModelDialogTitle';
    title.className = 'fork-model-dialog__title';
    title.textContent = 'Fork with different model';

    const providerLabel = document.createElement('label');
    providerLabel.className = 'fork-model-dialog__label';
    providerLabel.textContent = 'Provider';
    const providerSelect = document.createElement('select');
    providerSelect.className = 'fork-model-dialog__select';

    const modelLabel = document.createElement('label');
    modelLabel.className = 'fork-model-dialog__label';
    modelLabel.textContent = 'Model';
    const modelSelect = document.createElement('select');
    modelSelect.className = 'fork-model-dialog__select';

    const actions = document.createElement('div');
    actions.className = 'fork-model-dialog__actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'fork-model-dialog__btn fork-model-dialog__btn--ghost';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'fork-model-dialog__btn fork-model-dialog__btn--primary';
    okBtn.textContent = 'Fork';

    const close = (result: ForkModelDialogResult | null): void => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close(null);
    };

    cancelBtn.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => {
      const providerId = providerSelect.value.trim();
      const modelId = modelSelect.value.trim();
      if (!providerId || !modelId) return;
      const sampler = readSamplerFromDom();
      close({
        providerId,
        modelId,
        temperature: initial.temperature ?? sampler.temperature,
        maxTokens: initial.maxTokens ?? sampler.maxTokens,
      });
    });

    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) close(null);
    });

    actions.append(cancelBtn, okBtn);
    panel.append(title, providerLabel, providerSelect, modelLabel, modelSelect, actions);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey);

    void (async () => {
      const { providers } = await listProviders();
      const preProvider = initial.providerId ?? providers[0]?.id ?? '';
      for (const p of providers) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label || p.id;
        if (p.id === preProvider) opt.selected = true;
        providerSelect.appendChild(opt);
      }

      const fillModels = async (): Promise<void> => {
        modelSelect.innerHTML = '';
        await fetchModels();
        const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
        if (!sel) return;
        for (const opt of Array.from(sel.options)) {
          if (!opt.value) continue;
          const m = document.createElement('option');
          m.value = opt.value;
          m.textContent = opt.textContent ?? opt.value;
          if (opt.value === (initial.modelId ?? '')) m.selected = true;
          modelSelect.appendChild(m);
        }
        if (!modelSelect.value && modelSelect.options.length > 0) {
          modelSelect.selectedIndex = 0;
        }
      };

      providerSelect.addEventListener('change', () => {
        void fillModels();
      });

      await fillModels();
      okBtn.focus();
    })();
  });
}
