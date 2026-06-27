/**
 * Wire the board log JSONL mirror to the local tool server.
 */

import { reportBackgroundError } from '../boot/report-background-error.ts';
import { setBoardLogDiskSink } from './orchestrate-board-store.ts';
import type { BoardLogEvent } from '../types.ts';

const MIRROR_MAX_RETRIES = 3;
const MIRROR_RETRY_BASE_MS = 200;

let mirrorReady: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until the board-log mirror route responds before the first append. */
function ensureBoardLogMirrorReady(): Promise<void> {
  if (!mirrorReady) {
    mirrorReady = fetch('/api/orchestrate/board-log', { method: 'GET' })
      .then(() => undefined)
      .catch(() => undefined);
  }
  return mirrorReady;
}

async function postBoardLogMirror(groupId: string, event: BoardLogEvent): Promise<void> {
  await ensureBoardLogMirrorReady();
  let lastStatus = 0;
  for (let attempt = 0; attempt < MIRROR_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(MIRROR_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
    const res = await fetch('/api/orchestrate/board-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, event }),
    });
    if (res.ok) return;
    lastStatus = res.status;
    if (res.status !== 404 && res.status < 500) break;
  }
  reportBackgroundError(
    'board-log-disk',
    new Error(`board-log mirror HTTP ${lastStatus || 'failed'}`),
  );
}

/** Fire-and-forget POST of each log row to ~/.minnow/logs/orchestrate/<groupId>.jsonl. */
export function initBoardLogDiskSink(): void {
  setBoardLogDiskSink((groupId: string, event: BoardLogEvent) => {
    void postBoardLogMirror(groupId, event).catch((err) => {
      reportBackgroundError('board-log-disk', err);
    });
  });
}

/** Reset boot gate between tests. */
export function resetBoardLogDiskSinkForTests(): void {
  mirrorReady = null;
}
