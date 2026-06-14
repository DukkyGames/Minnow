/**
 * Models — llama.cpp serve dialog (preset + advanced launch controls).
 */

import {
  fetchLlamaRuntime,
  fetchServeProfiles,
  startModelServe,
  type LlamaServeSettings,
  type ServeRecord,
} from '../../models/api-client';
import { setStatus } from '../status';

export interface OpenServeDialogOptions {
  modelPath: string;
  modelLabel: string;
  hardware?: Record<string, unknown>;
  quant?: string;
  paramsB?: number;
  isMoe?: boolean;
  weightsGb?: number;
}

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

function sessionKey(modelPath: string): string {
  const name = modelPath.split(/[/\\]/).pop() ?? modelPath;
  return `minnow-serve-settings:${name}`;
}

function loadSavedSettings(modelPath: string): Partial<LlamaServeSettings> {
  try {
    const raw = sessionStorage.getItem(sessionKey(modelPath));
    return raw ? (JSON.parse(raw) as Partial<LlamaServeSettings>) : {};
  } catch {
    return {};
  }
}

function saveSettings(modelPath: string, settings: LlamaServeSettings): void {
  try {
    sessionStorage.setItem(sessionKey(modelPath), JSON.stringify(settings));
  } catch {
    /* quota */
  }
}

function numInput(label: string, value: number | undefined, id: string): HTMLElement {
  const wrap = el('label', 'models-serve-field');
  wrap.htmlFor = id;
  wrap.append(el('span', 'models-serve-field__label', label));
  const input = el('input', 'models-serve-field__input') as HTMLInputElement;
  input.type = 'number';
  input.id = id;
  if (value != null) input.value = String(value);
  wrap.appendChild(input);
  return wrap;
}

function selectInput(
  label: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  id: string,
): HTMLElement {
  const wrap = el('label', 'models-serve-field');
  wrap.htmlFor = id;
  wrap.append(el('span', 'models-serve-field__label', label));
  const select = el('select', 'models-serve-field__input') as HTMLSelectElement;
  select.id = id;
  for (const opt of options) {
    const o = el('option', undefined, opt.label) as HTMLOptionElement;
    o.value = opt.value;
    if (opt.value === value) o.selected = true;
    select.appendChild(o);
  }
  wrap.appendChild(select);
  return wrap;
}

/**
 * Open the serve dialog and return the started serve record, or null when cancelled.
 */
export function openServeDialog(opts: OpenServeDialogOptions): Promise<ServeRecord | null> {
  return new Promise((resolve) => {
    const backdrop = el('div', 'models-serve-dialog__backdrop');
    const dialog = el('div', 'models-serve-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'modelsServeDialogTitle');

    const title = el('h2', 'models-serve-dialog__title', 'Serve with llama.cpp');
    title.id = 'modelsServeDialogTitle';
    dialog.appendChild(title);
    dialog.appendChild(el('p', 'models-muted', opts.modelLabel));

    const runtimeBadge = el('p', 'models-serve-runtime-badge', 'Loading runtime…');
    dialog.appendChild(runtimeBadge);

    const presetRow = el('div', 'models-serve-presets');
    dialog.appendChild(presetRow);

    const form = el('div', 'models-serve-form');
    dialog.appendChild(form);

    let selectedProfile = 'balanced';
    let profilesLoaded: Awaited<ReturnType<typeof fetchServeProfiles>> | null = null;

    const ctxField = numInput('Context (-c)', 4096, 'serveCtx');
    const nglField = selectInput(
      'GPU layers (-ngl)',
      [
        { value: '999', label: 'All layers (GPU)' },
        { value: '0', label: 'CPU only' },
        { value: 'custom', label: 'Custom…' },
      ],
      '999',
      'serveNgl',
    );
    const nglCustom = numInput('Custom GPU layers', undefined, 'serveNglCustom');
    (nglCustom.querySelector('input') as HTMLInputElement).style.display = 'none';

    const cacheField = selectInput(
      'KV cache type',
      [
        { value: 'q8_0', label: 'q8_0 (balanced)' },
        { value: 'q4_0', label: 'q4_0 (smaller)' },
        { value: 'f16', label: 'f16 (full)' },
      ],
      'q8_0',
      'serveCache',
    );

    form.append(ctxField, nglField, nglCustom, cacheField);

    const advanced = el('details', 'models-serve-advanced');
    const advancedSummary = el('summary', undefined, 'Advanced');
    advanced.appendChild(advancedSummary);
    const batchField = numInput('Batch (-b)', undefined, 'serveBatch');
    const ubatchField = numInput('Micro-batch (-ub)', undefined, 'serveUbatch');
    const parallelField = numInput('Parallel slots', undefined, 'serveParallel');
    const extraField = el('label', 'models-serve-field');
    extraField.append(el('span', 'models-serve-field__label', 'Extra args (space-separated)'));
    const extraInput = el('input', 'models-serve-field__input') as HTMLInputElement;
    extraInput.id = 'serveExtra';
    extraInput.placeholder = '--no-mmap --flash-attn';
    extraField.appendChild(extraInput);
    const unifiedWrap = el('label', 'models-serve-field models-serve-field--checkbox');
    const unifiedCheck = el('input') as HTMLInputElement;
    unifiedCheck.type = 'checkbox';
    unifiedCheck.id = 'serveUnifiedMem';
    unifiedWrap.append(unifiedCheck, el('span', undefined, 'CUDA unified memory (GGML_CUDA_ENABLE_UNIFIED_MEMORY)'));
    advanced.append(batchField, ubatchField, parallelField, extraField, unifiedWrap);
    dialog.appendChild(advanced);

    const actions = el('div', 'models-serve-dialog__actions');
    const cancelBtn = el('button', 'models-inline-btn', 'Cancel');
    cancelBtn.type = 'button';
    const serveBtn = el('button', 'models-inline-btn is-primary', 'Serve');
    serveBtn.type = 'button';
    actions.append(cancelBtn, serveBtn);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const close = (result: ServeRecord | null) => {
      backdrop.remove();
      resolve(result);
    };

    cancelBtn.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });

    const nglSelect = nglField.querySelector('select') as HTMLSelectElement;
    nglSelect.addEventListener('change', () => {
      const customInput = nglCustom.querySelector('input') as HTMLInputElement;
      customInput.style.display = nglSelect.value === 'custom' ? '' : 'none';
    });

    const applyProfile = (key: string) => {
      selectedProfile = key;
      const profile = profilesLoaded?.profiles.find((p) => p.key === key);
      if (!profile) return;
      (ctxField.querySelector('input') as HTMLInputElement).value = String(profile.ctx);
      nglSelect.value = profile.n_gpu_layers === 0 ? '0' : '999';
      (cacheField.querySelector('select') as HTMLSelectElement).value = profile.cache_type;
    };

    void (async () => {
      try {
        const [runtime, profiles] = await Promise.all([
          fetchLlamaRuntime(),
          fetchServeProfiles({
            model: opts.modelLabel,
            quant: opts.quant,
            params_b: opts.paramsB,
            weights_gb: opts.weightsGb,
            is_moe: opts.isMoe,
          }),
        ]);
        profilesLoaded = profiles;
        runtimeBadge.textContent = runtime.path
          ? `Runtime: ${runtime.variant ?? 'cpu'} · ${runtime.version ?? ''}`
          : `Runtime: not installed (${runtime.preferredVariant ?? 'cpu'} recommended)`;

        const saved = loadSavedSettings(opts.modelPath);
        if (saved.ctx != null) {
          (ctxField.querySelector('input') as HTMLInputElement).value = String(saved.ctx);
        }
        if (saved.n_gpu_layers != null) {
          nglSelect.value =
            saved.n_gpu_layers === 0 ? '0' : saved.n_gpu_layers === 999 ? '999' : 'custom';
          if (nglSelect.value === 'custom') {
            (nglCustom.querySelector('input') as HTMLInputElement).value = String(
              saved.n_gpu_layers,
            );
            (nglCustom.querySelector('input') as HTMLInputElement).style.display = '';
          }
        }
        if (saved.cache_type) {
          (cacheField.querySelector('select') as HTMLSelectElement).value = saved.cache_type;
        }

        presetRow.replaceChildren();
        for (const p of profiles.profiles) {
          const btn = el('button', 'models-serve-preset-btn', p.label);
          btn.type = 'button';
          btn.title = p.note;
          if (p.key === selectedProfile) btn.classList.add('is-active');
          btn.addEventListener('click', () => {
            presetRow.querySelectorAll('.models-serve-preset-btn').forEach((b) => {
              b.classList.remove('is-active');
            });
            btn.classList.add('is-active');
            applyProfile(p.key);
          });
          presetRow.appendChild(btn);
        }
        applyProfile(selectedProfile);
      } catch (err) {
        runtimeBadge.textContent =
          err instanceof Error ? err.message : 'Failed to load serve presets';
      }
    })();

    serveBtn.addEventListener('click', () => {
      const ctx = Number((ctxField.querySelector('input') as HTMLInputElement).value);
      let ngl = 999;
      if (nglSelect.value === '0') ngl = 0;
      else if (nglSelect.value === 'custom') {
        ngl = Number((nglCustom.querySelector('input') as HTMLInputElement).value);
      }

      /** @type {LlamaServeSettings} */
      const llama: LlamaServeSettings = {
        ctx: Number.isFinite(ctx) ? ctx : 4096,
        n_gpu_layers: Number.isFinite(ngl) ? ngl : 999,
        cache_type: (cacheField.querySelector('select') as HTMLSelectElement).value,
      };

      const batch = Number((batchField.querySelector('input') as HTMLInputElement).value);
      if (Number.isFinite(batch) && batch > 0) llama.batch_size = batch;

      const ubatch = Number((ubatchField.querySelector('input') as HTMLInputElement).value);
      if (Number.isFinite(ubatch) && ubatch > 0) llama.ubatch_size = ubatch;

      const parallel = Number((parallelField.querySelector('input') as HTMLInputElement).value);
      if (Number.isFinite(parallel) && parallel > 0) llama.parallel = parallel;

      const extraRaw = extraInput.value.trim();
      if (extraRaw) llama.extra_args = extraRaw.split(/\s+/);

      if (unifiedCheck.checked) {
        llama.env = { GGML_CUDA_ENABLE_UNIFIED_MEMORY: '1' };
      }

      saveSettings(opts.modelPath, llama);
      serveBtn.disabled = true;
      serveBtn.textContent = 'Starting…';

      void startModelServe({
        modelPath: opts.modelPath,
        runtime: 'llama-cpp',
        modelLabel: opts.modelLabel,
        profile: selectedProfile,
        hardware: opts.hardware,
        quant: opts.quant,
        paramsB: opts.paramsB,
        isMoe: opts.isMoe,
        weightsGb: opts.weightsGb,
        llama,
      })
        .then((serve) => close(serve))
        .catch((err) => {
          setStatus('err', err instanceof Error ? err.message : 'Serve failed');
          serveBtn.disabled = false;
          serveBtn.textContent = 'Serve';
        });
    });
  });
}
