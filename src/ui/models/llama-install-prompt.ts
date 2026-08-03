/**
 * Models — confirm the llama.cpp runtime install before loading a GGUF.
 *
 * A modal is right here: this downloads a binary, so it needs an explicit yes
 * before anything happens.
 */

import {
  fetchLlamaRuntime,
  installLlamaRuntime,
  subscribeLlamaInstallProgress,
  type LlamaRuntimeStatus,
} from '../../models/api-client';
import { el, textButton } from './dom';

function renderProgressBar(percent: number | null): HTMLElement {
  const wrap = el('div', 'models-progress');
  const bar = el('div', 'models-progress__fill');
  if (percent != null && percent > 0) {
    bar.style.width = `${Math.min(100, percent)}%`;
  } else {
    bar.classList.add('is-indeterminate');
  }
  wrap.appendChild(bar);
  return wrap;
}

/**
 * Resolves true when llama-server is available (already installed, or the user
 * approved and the install succeeded), false when cancelled or failed.
 */
export async function ensureLlamaRuntimeInstalled(): Promise<boolean> {
  const runtime = await fetchLlamaRuntime();
  if (runtime.path) return true;
  return promptLlamaInstall(runtime);
}

/** Ask before downloading the llama.cpp server binary. */
export function promptLlamaInstall(runtime: LlamaRuntimeStatus): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = el('div', 'models-dialog__backdrop');
    const dialog = el('div', 'models-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'modelsLlamaInstallTitle');

    const title = el('h2', 'models-dialog__title', 'llama.cpp runtime required');
    title.id = 'modelsLlamaInstallTitle';
    dialog.appendChild(title);

    const body = el('div', 'models-dialog__body');
    dialog.appendChild(body);

    const progressWrap = el('div', 'models-dialog__progress hidden');
    const progressBarHost = el('div');
    const progressLabel = el('p', 'models-dialog__progress-label', '');
    progressWrap.append(progressBarHost, progressLabel);
    dialog.appendChild(progressWrap);

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(ok);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !primaryBtn.disabled) finish(false);
    };

    const actions = el('div', 'models-dialog__actions');
    const cancelBtn = textButton('Cancel', () => finish(false));
    const primaryBtn = textButton('Install', () => {}, 'primary');
    actions.append(cancelBtn, primaryBtn);
    dialog.appendChild(actions);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey);
    primaryBtn.focus();

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && !primaryBtn.disabled) finish(false);
    });

    if (!runtime.installable) {
      body.append(
        el(
          'p',
          'models-muted',
          'llama-server was not found, and Minnow has no prebuilt binary for this platform.',
        ),
        el(
          'p',
          'models-muted',
          'Build or install llama.cpp yourself and put llama-server on your PATH, or run the model through Ollama or LM Studio instead.',
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
        `Loading GGUF weights needs the llama-server binary — about 20 MB, ${variant} build.`,
      ),
      el('p', 'models-muted', 'Download it now?'),
    );

    primaryBtn.addEventListener('click', () => {
      if (primaryBtn.disabled) return;
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
        .then((result) => finish(Boolean(result.path)))
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
