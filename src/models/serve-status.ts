/**
 * Shared serve-status copy for Local Server, My Models, and the inspector.
 * `crashed` is a mid-session death; `stopped` is a user eject; `error` is a
 * failed load; `unhealthy` is a live PID that stopped answering /health.
 */

import type { LlamaServeSettings, ServeRecord } from './api-client';

export type ServeStatus = ServeRecord['status'];

/** Statuses that still own a process we may need to stop. */
export function isLiveServeStatus(status: ServeStatus): boolean {
  return status === 'running' || status === 'starting' || status === 'unhealthy';
}

/** Statuses that should offer Retry (reload the same weights). */
export function isRetryableServeStatus(status: ServeStatus): boolean {
  return status === 'crashed' || status === 'error';
}

/**
 * Merge a diagnosis `suggestedSettings` onto the current launch payload.
 * Always `fit_mode: 'manual'` so the planner cannot raise ctx back into OOM.
 */
export function settingsForServeRetry(
  serve: ServeRecord,
  base: LlamaServeSettings = {},
): LlamaServeSettings {
  const from = base ?? {};
  const suggested = serve.failure?.suggestedSettings;
  if (!suggested) return { ...from };
  const extra_args = [
    ...(Array.isArray(from.extra_args) ? from.extra_args : []),
    ...(Array.isArray(suggested.extra_args) ? suggested.extra_args : []),
  ].filter((token, index, all) => all.indexOf(token) === index);
  return {
    ...from,
    ...suggested,
    fit_mode: 'manual',
    ...(extra_args.length ? { extra_args } : {}),
  };
}

/** Button label: one specific Retry when the server attached a payload. */
export function retryLabelForServe(serve: ServeRecord): string {
  return serve.failure?.suggestedSettings ? 'Retry with suggested settings' : 'Retry';
}

/** Short title-case label for chips and the header. */
export function serveStatusLabel(status: ServeStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'starting':
      return 'Starting';
    case 'stopped':
      return 'Stopped';
    case 'error':
      return 'Error';
    case 'crashed':
      return 'Crashed';
    case 'unhealthy':
      return 'Unhealthy';
    default:
      return 'Stopped';
  }
}
