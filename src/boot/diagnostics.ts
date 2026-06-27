/**
 * Renderer global error handlers — surface crashes visibly and forward to main log.
 */

import { pushNotification } from '../notifications/push';
import { addBug, isBugsStoreLoaded, updateBug } from '../state/bug-board-store';
import { getWorkspacePath } from '../state/workspace';
import { setStatus } from '../ui/status';

const KEY_DEDUPE_MS = 10_000;
const BUG_CARD_WINDOW_MS = 60_000;
const BUG_CARD_CAP = 5;

/** Tracks per-key UI dedupe and global bug-card rate limit. */
type SurfaceState = {
  lastSurfacedByKey: Map<string, number>;
  bugCardTimestamps: number[];
  suppressedCount: number;
  suppressionBugId: string | null;
};

const surfaceState: SurfaceState = {
  lastSurfacedByKey: new Map(),
  bugCardTimestamps: [],
  suppressedCount: 0,
  suppressionBugId: null,
};

/** Reset dedupe state (tests only). */
export function resetDiagnosticsSurfaceStateForTests(): void {
  surfaceState.lastSurfacedByKey.clear();
  surfaceState.bugCardTimestamps.length = 0;
  surfaceState.suppressedCount = 0;
  surfaceState.suppressionBugId = null;
}

/** Extract first stack frame for dedupe key stability. */
export function firstStackFrame(stack?: string): string {
  if (!stack) return '';
  const line = stack.split('\n').find((l) => l.trim().startsWith('at '));
  return line?.trim() ?? '';
}

/** Build dedupe key from kind, message, and first stack frame. */
export function buildSurfaceKey(kind: string, message: string, stack?: string): string {
  return `${kind}|${message}|${firstStackFrame(stack)}`;
}

/**
 * Decide whether to surface UI for an error.
 * Always logs to main; UI may be suppressed by per-key or global caps.
 */
export function shouldSurface(
  key: string,
  nowMs: number,
  state: SurfaceState = surfaceState,
): { logToMain: boolean; surfaceUi: boolean; rollSuppressionCard: boolean } {
  const lastForKey = state.lastSurfacedByKey.get(key);
  if (lastForKey !== undefined && nowMs - lastForKey < KEY_DEDUPE_MS) {
    return { logToMain: true, surfaceUi: false, rollSuppressionCard: false };
  }

  while (
    state.bugCardTimestamps.length > 0 &&
    nowMs - state.bugCardTimestamps[0]! > BUG_CARD_WINDOW_MS
  ) {
    state.bugCardTimestamps.shift();
  }

  if (state.bugCardTimestamps.length >= BUG_CARD_CAP) {
    state.suppressedCount += 1;
    return { logToMain: true, surfaceUi: false, rollSuppressionCard: true };
  }

  state.lastSurfacedByKey.set(key, nowMs);
  state.bugCardTimestamps.push(nowMs);
  state.suppressedCount = 0;
  state.suppressionBugId = null;
  return { logToMain: true, surfaceUi: true, rollSuppressionCard: false };
}

function truncateStatus(message: string, max = 80): string {
  const trimmed = message.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function report(kind: string, message: string, stack?: string): void {
  const key = buildSurfaceKey(kind, message, stack);
  const decision = shouldSurface(key, Date.now());

  console.error(`[diagnostics] ${kind}: ${message}`, stack ?? '');

  window.minnow?.diagnostics?.reportError({ kind, message, stack });

  setStatus('err', truncateStatus(message));

  if (!isBugsStoreLoaded()) return;

  if (decision.rollSuppressionCard) {
    const count = surfaceState.suppressedCount;
    const title = `+${count} more suppressed errors`;
    const description = `${kind}\n${message}\n${stack ?? ''}`;
    if (surfaceState.suppressionBugId) {
      updateBug(surfaceState.suppressionBugId, { notes: description });
    } else {
      const bugId = `bug-crash-${Date.now().toString(36)}`;
      addBug(
        {
          title,
          description,
          severity: 'critical',
          workspacePath: getWorkspacePath(),
        },
        bugId,
      );
      surfaceState.suppressionBugId = bugId;
    }
    return;
  }

  if (!decision.surfaceUi) return;

  const bugId = `bug-crash-${Date.now().toString(36)}`;
  const title = message.trim() || kind;
  addBug(
    {
      title,
      description: `${kind}\n${stack ?? message}`,
      severity: 'critical',
      workspacePath: getWorkspacePath(),
    },
    bugId,
  );

  pushNotification({
    kind: 'chat_turn_error',
    title: 'Application error',
    preview: truncateStatus(message, 120),
    appId: 'code',
    dedupeKey: `crash:${key}`,
  });
}

/** Install global renderer error handlers and recover last renderer crash marker. */
export function installRendererDiagnostics(): void {
  window.addEventListener('error', (ev) => {
    const message =
      ev.message || (ev.error instanceof Error ? ev.error.message : '') || 'Script error';
    const stack = ev.error instanceof Error ? ev.error.stack : undefined;
    report('uncaught-error', message, stack);
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled rejection';
    const stack = reason instanceof Error ? reason.stack : undefined;
    report('unhandled-rejection', message, stack);
  });

  void window.minnow?.diagnostics?.getLastCrash?.().then((marker) => {
    if (!marker) return;
    const isOom = marker.reason === 'oom';
    const message = isOom
      ? 'Board auto-pilot paused after out-of-memory crash — press Start when ready.'
      : `Recovered from crash: ${marker.reason ?? marker.kind} (exit ${marker.exitCode ?? '?'})`;
    report('render-process-gone-recovered', message, marker.message);
  });
}
