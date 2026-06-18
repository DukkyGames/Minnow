/**
 * Models — confirm llama.cpp runtime install before serving a GGUF.
 */

import {
  fetchLlamaRuntime,
  installLlamaRuntime,
  subscribeLlamaInstallProgress,
  type LlamaRuntimeStatus,
} from '../../models/api-client';

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

function renderProgressBar(percent: number | null): HTMLElement {
  const wrap = el('div', 'models-download-progress');
  const bar = el('div', 'models-download-progress__bar');
  if (percent != null && percent > 0) {
    bar.style.width = `${Math.min(100, percent)}%`;
  } else {
    bar.style.width = '30%';
    bar.classList.add('is-indeterminate');
  }
  wrap.appendChild(bar);
  return wrap;
}

/**
 * Returns true when llama-server is installed (or install succeeded), false when cancelled or failed.
 */
export async function ensureLlamaRuntimeInstalled(): Promise<boolean> {
  const runtime = await fetchLlamaRuntime();
  if (runtime.path) return true;
  return promptLlamaInstall(runtime);
}

/**
 * Modal prompt — install bundled llama.cpp or show manual-install guidance.
 */
export function promptLlamaInstall(runtime: LlamaRuntimeStatus): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = el('div', 'models-serve-dialog__backdrop');
    const dialog = el('div', 'models-serve-dialog models-llama-install-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'modelsLlamaInstallTitle');

    const title = el('h2', 'models-serve-dialog__title', 'llama.cpp runtime required');
    title.id = 'modelsLlamaInstallTitle';
    dialog.appendChild(title);

    const body = el('div', 'models-llama-install-body');
    dialog.appendChild(body);

    const progressWrap = el('div', 'models-llama-install-progress hidden');
    const progressBarHost = el('div', 'models-llama-install-progress__bar');
    const progressLabel = el('p', 'models-muted models-llama-install-progress__label', '');
    progressWrap.append(progressBarHost, progressLabel);
    dialog.appendChild(progressWrap);

    const actions = el('div', 'models-serve-dialog__actions');
    const cancelBtn = el('button', 'models-inline-btn', 'Cancel');
    cancelBtn.type = 'button';
    const primaryBtn = el('button', 'models-inline-btn is-primary', 'Install');
    primaryBtn.type = 'button';
    actions.append(cancelBtn, primaryBtn);
    dialog.appendChild(actions);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      resolve(ok);
    };

    cancelBtn.addEventListener('click', () => finish(false));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && !primaryBtn.disabled) finish(false);
    });

    if (!runtime.installable) {
      body.append(
        el(
          'p',
          'models-muted',
          'llama-server was not found on this system and Minnow cannot auto-install a prebuilt binary for your platform.',
        ),
        el(
          'p',
          'models-muted',
          'Install llama.cpp server binaries manually and add llama-server to your PATH, or use Ollama / LM Studio instead.',
        ),
      );
      primaryBtn.textContent = 'Open Settings → Servers';
      primaryBtn.addEventListener('click', () => {
        void import('../settings-page').then(({ openSettings }) => {
          openSettings('servers');
          finish(false);
        });
      });
      return;
    }

    const variant = runtime.preferredVariant ?? 'cpu';
    body.append(
      el(
        'p',
        'models-muted',
        `Serving with llama.cpp requires the llama-server binary (~20 MB, ${variant} build).`,
      ),
      el('p', 'models-muted', 'Install now before configuring serve options?'),
    );

    primaryBtn.addEventListener('click', () => {
      primaryBtn.disabled = true;
      cancelBtn.disabled = true;
      progressWrap.classList.remove('hidden');
      progressLabel.textContent = 'Starting install…';
      progressBarHost.replaceChildren(renderProgressBar(null));

      const unsub = subscribeLlamaInstallProgress((job) => {
        progressLabel.textContent = job.message || job.phase;
        progressBarHost.replaceChildren(renderProgressBar(job.percent));
        if (job.phase === 'failed') {
          progressLabel.textContent = job.error ?? job.message;
        }
      });

      void installLlamaRuntime({ variant })
        .then((result) => {
          if (result.path) {
            finish(true);
            return;
          }
          finish(false);
        })
        .catch((err) => {
          progressLabel.textContent =
            err instanceof Error ? err.message : 'llama.cpp install failed';
          primaryBtn.disabled = false;
          cancelBtn.disabled = false;
        })
        .finally(() => unsub());
    });
  });
}
