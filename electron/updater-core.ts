/**
 * Pure auto-update state machine (MIN-384) — no Electron imports so it can be unit tested.
 * electron/updater.ts feeds electron-updater events through reduceUpdaterStatus and
 * broadcasts the resulting status to renderers.
 */

export type UpdaterChannel = 'stable' | 'beta';

/** Why updates are unavailable on this install. */
export type UpdaterUnsupportedReason = 'dev' | 'macos-signing';

export type UpdaterStateName =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdaterStatus {
  state: UpdaterStateName;
  supported: boolean;
  unsupportedReason: UpdaterUnsupportedReason | null;
  installedVersion: string;
  channel: UpdaterChannel;
  pendingVersion: string | null;
  releaseNotes: string | null;
  /** 0–100 while downloading, 100 when ready, null otherwise. */
  progressPercent: number | null;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  /** Set only for user-visible (manual) failures; background failures stay silent. */
  errorMessage: string | null;
}

export type UpdaterEvent =
  | { kind: 'check-started'; manual: boolean; at: number }
  | { kind: 'update-available'; version: string; notes: string | null; at: number }
  | { kind: 'update-not-available'; at: number }
  | { kind: 'download-progress'; percent: number }
  | { kind: 'update-downloaded'; version: string; notes: string | null; at: number }
  | { kind: 'check-error'; message: string; manual: boolean; at: number }
  | { kind: 'channel-changed'; channel: UpdaterChannel }
  | { kind: 'next-check-scheduled'; at: number };

/** Default background re-check cadence (spec: fixed 4h, not configurable in v1). */
export const UPDATER_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Coerce a persisted/IPC value to a valid channel. */
export function normalizeUpdaterChannel(value: unknown): UpdaterChannel {
  return value === 'beta' ? 'beta' : 'stable';
}

/**
 * Flatten electron-updater releaseNotes (string | ReleaseNoteInfo[] | null) to plain text.
 * HTML tags are stripped — renderers show an excerpt, not rich markup.
 */
export function releaseNotesToText(notes: unknown): string | null {
  const parts: string[] = [];
  if (typeof notes === 'string') {
    parts.push(notes);
  } else if (Array.isArray(notes)) {
    for (const item of notes) {
      if (item && typeof item === 'object' && typeof (item as { note?: unknown }).note === 'string') {
        parts.push((item as { note: string }).note);
      }
    }
  }
  const text = parts
    .join('\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return text.length > 0 ? text : null;
}

export function createInitialUpdaterStatus(options: {
  supported: boolean;
  unsupportedReason?: UpdaterUnsupportedReason | null;
  installedVersion: string;
  channel: UpdaterChannel;
}): UpdaterStatus {
  return {
    state: options.supported ? 'idle' : 'unsupported',
    supported: options.supported,
    unsupportedReason: options.supported ? null : (options.unsupportedReason ?? 'dev'),
    installedVersion: options.installedVersion,
    channel: options.channel,
    pendingVersion: null,
    releaseNotes: null,
    progressPercent: null,
    lastCheckedAt: null,
    nextCheckAt: null,
    errorMessage: null,
  };
}

/**
 * Apply one updater event. Rules from MIN-384:
 * - Background check failures are silent (state returns to idle, no errorMessage).
 * - Manual failures surface inline (state 'error' + message).
 * - A downloaded update is never lost to a later failed or empty check.
 */
export function reduceUpdaterStatus(status: UpdaterStatus, event: UpdaterEvent): UpdaterStatus {
  if (!status.supported) {
    // Unsupported installs only track channel/schedule bookkeeping.
    if (event.kind === 'channel-changed') return { ...status, channel: event.channel };
    return status;
  }

  switch (event.kind) {
    case 'check-started':
      if (status.state === 'ready' || status.state === 'downloading') return status;
      return { ...status, state: 'checking', errorMessage: null };

    case 'update-available':
      if (status.state === 'ready') return status;
      return {
        ...status,
        state: 'downloading',
        pendingVersion: event.version,
        releaseNotes: event.notes,
        progressPercent: 0,
        lastCheckedAt: event.at,
        errorMessage: null,
      };

    case 'update-not-available':
      if (status.state === 'ready' || status.state === 'downloading') {
        return { ...status, lastCheckedAt: event.at };
      }
      return {
        ...status,
        state: 'idle',
        pendingVersion: null,
        releaseNotes: null,
        progressPercent: null,
        lastCheckedAt: event.at,
        errorMessage: null,
      };

    case 'download-progress':
      if (status.state === 'ready') return status;
      return {
        ...status,
        state: 'downloading',
        progressPercent: Math.max(0, Math.min(100, Math.round(event.percent))),
      };

    case 'update-downloaded':
      return {
        ...status,
        state: 'ready',
        pendingVersion: event.version,
        releaseNotes: event.notes ?? status.releaseNotes,
        progressPercent: 100,
        lastCheckedAt: event.at,
        errorMessage: null,
      };

    case 'check-error':
      if (status.state === 'ready') return { ...status, lastCheckedAt: event.at };
      if (!event.manual) {
        // Silent-with-log: corrupt/failed background work retries next cycle.
        return {
          ...status,
          state: 'idle',
          progressPercent: null,
          lastCheckedAt: event.at,
          errorMessage: null,
        };
      }
      return {
        ...status,
        state: 'error',
        progressPercent: null,
        lastCheckedAt: event.at,
        errorMessage: event.message,
      };

    case 'channel-changed':
      return { ...status, channel: event.channel };

    case 'next-check-scheduled':
      return { ...status, nextCheckAt: event.at };
  }
}
