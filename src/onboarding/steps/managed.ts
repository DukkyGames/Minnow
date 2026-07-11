/**
 * S2b — Managed models: hardware-aware install, download, and serve.
 */

import { fetchHardware } from '../../models/hardware-client';
import { el, createStatusPill, renderStepHeader } from '../ui-helpers';
import {
  pickRecommendedModel,
  runManagedModelSetup,
  type ManagedSetupProgress,
} from '../managed-setup';
import type { ModelFitResult } from '../../models/types';
import type { HardwareSnapshot } from '../../models/types';
import type { OnboardingContext, OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

let recommended: ModelFitResult | null = null;
let hardware: HardwareSnapshot | null = null;
let setupDone = false;
let setupError = '';
let activeProgress: ManagedSetupProgress | null = null;
let installing = false;

function formatHardware(hw: HardwareSnapshot): string {
  const gpu = hw.gpuName ? `${hw.gpuName} · ${hw.gpuVramGb ?? '?'} GB VRAM` : 'CPU only';
  return `${hw.cpuName} · ${hw.totalRamGb} GB RAM · ${gpu}`;
}

function renderProgressBar(host: HTMLElement, percent: number): void {
  host.replaceChildren();
  const track = el('div', 'mn-onboarding-progress-track');
  const fill = el('div', 'mn-onboarding-progress-fill');
  fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  track.appendChild(fill);
  host.appendChild(track);
}

export const providerManagedStep: OnboardingStep = {
  id: 'provider-managed',
  title: 'Managed models',
  canSkip: true,

  isApplicable(ctx) {
    return ctx.providerPath === 'managed';
  },

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';

    renderStepHeader(container, providerManagedStep, actions.stepIndex, actions.totalSteps);

    if (!ctx.serverAvailable) {
      container.appendChild(
        el(
          'p',
          'mn-onboarding-notice',
          'Local installs need npm start. You can finish theme and permissions now, then run setup again later.',
        ),
      );
      actions.setPrimaryEnabled(true);
      actions.setPrimaryLabel('Continue');
      return;
    }

    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'Minnow installs llama.cpp, picks a model for your hardware, downloads it, and starts the server.',
      ),
    );

    const hwCard = el('div', 'mn-onboarding-info-card');
    const hwLine = el('p', 'mn-onboarding-hardware-line', 'Scanning hardware…');
    hwCard.appendChild(hwLine);
    container.appendChild(hwCard);

    const recCard = el('div', 'mn-onboarding-recommend-card hidden');
    const recTitle = el('h3', 'mn-onboarding-subtitle', 'Recommended model');
    const recBody = el('p', 'mn-onboarding-recommend-body', '');
    const recMeta = el('p', 'mn-onboarding-muted', '');
    recCard.append(recTitle, recBody, recMeta);
    container.appendChild(recCard);

    const statusRow = el('div', 'mn-onboarding-status-row');
    const statusPill = createStatusPill('pending', 'Ready');
    statusRow.appendChild(statusPill);
    container.appendChild(statusRow);

    const progressHost = el('div', 'mn-onboarding-managed-progress hidden');
    const progressLabel = el('p', 'mn-onboarding-muted', '');
    const progressBarHost = el('div', 'mn-onboarding-managed-progress__bar');
    progressHost.append(progressLabel, progressBarHost);
    container.appendChild(progressHost);

    const installBtn = el('button', 'mn-onboarding-secondary-btn', 'Install and start');
    installBtn.type = 'button';
    container.appendChild(installBtn);

    const refreshUi = () => {
      if (hardware) {
        hwLine.textContent = formatHardware(hardware);
      }
      if (recommended) {
        recCard.classList.remove('hidden');
        recBody.textContent = recommended.name;
        recMeta.textContent = `${recommended.params_b}B · ${recommended.quant} · ${recommended.size_gb} GB · ${recommended.fit_level.replace('_', ' ')} · ~${recommended.speed_tps} tok/s`;
      }
      if (activeProgress) {
        progressHost.classList.remove('hidden');
        progressLabel.textContent = activeProgress.message;
        renderProgressBar(progressBarHost, activeProgress.percent);
        if (activeProgress.phase === 'error') {
          statusPill.className = 'mn-onboarding-status mn-onboarding-status--err';
          statusPill.textContent = activeProgress.error || 'Failed';
        } else if (activeProgress.phase === 'done' || setupDone) {
          statusPill.className = 'mn-onboarding-status mn-onboarding-status--ok';
          statusPill.textContent = 'Running';
        } else if (installing) {
          statusPill.className = 'mn-onboarding-status mn-onboarding-status--pending';
          statusPill.textContent = 'Working…';
        }
      }
      installBtn.hidden = setupDone || installing;
      actions.setPrimaryEnabled(setupDone || Boolean(setupError));
      actions.setPrimaryLabel(setupDone ? 'Continue' : 'Skip for now');
    };

    void (async () => {
      try {
        hardware = await fetchHardware({ fresh: true });
        recommended = pickRecommendedModel(hardware);
        if (!recommended) {
          setupError = 'No fitting model found in the catalog.';
          hwLine.textContent = formatHardware(hardware);
          statusPill.className = 'mn-onboarding-status mn-onboarding-status--err';
          statusPill.textContent = setupError;
        }
      } catch (err) {
        setupError = err instanceof Error ? err.message : 'Hardware scan failed';
        hwLine.textContent = setupError;
      }
      refreshUi();
    })();

    installBtn.addEventListener('click', () => {
      if (installing || setupDone) return;
      installing = true;
      setupError = '';
      refreshUi();
      void runManagedModelSetup((progress) => {
        activeProgress = progress;
        if (progress.phase === 'done') {
          setupDone = true;
          installing = false;
          ctx.providerId = 'llama-cpp-local';
          ctx.modelId = recommended?.name.split('/').pop() ?? null;
          actions.patchContext({
            providerId: ctx.providerId,
            modelId: ctx.modelId,
          });
        }
        if (progress.phase === 'error') {
          setupError = progress.error || progress.message;
          installing = false;
        }
        refreshUi();
      }).then((result) => {
        if (result.ok && result.providerId) {
          setupDone = true;
          ctx.providerId = result.providerId;
          ctx.modelId = result.modelId ?? null;
          actions.patchContext({
            providerId: result.providerId,
            modelId: result.modelId ?? null,
          });
        } else if (!result.ok) {
          setupError = result.error || 'Setup failed';
        }
        installing = false;
        refreshUi();
      });
    });

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(setupDone);
    refreshUi();
  },

  commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'provider-managed', {
      done: setupDone,
      skipped: !setupDone,
      data: {
        path: 'managed',
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        recommended: recommended?.name ?? null,
      },
    });
  },
};

/** Reset module state when wizard reopens. */
export function resetManagedStepState(): void {
  recommended = null;
  hardware = null;
  setupDone = false;
  setupError = '';
  activeProgress = null;
  installing = false;
}
