/**
 * Wire the board log JSONL mirror to the local tool server.
 */

import { reportBackgroundError } from '../boot/report-background-error.ts';
import { setBoardLogDiskSink } from './orchestrate-board-store.ts';
import type { BoardLogEvent } from '../types.ts';

/** Fire-and-forget POST of each log row to ~/.minnow/logs/orchestrate/<groupId>.jsonl. */
export function initBoardLogDiskSink(): void {
  setBoardLogDiskSink((groupId: string, event: BoardLogEvent) => {
    void fetch('/api/orchestrate/board-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, event }),
    }).then((res) => {
      if (!res.ok) {
        reportBackgroundError(
          'board-log-disk',
          new Error(`board-log mirror HTTP ${res.status}`),
        );
      }
    }).catch((err) => {
      reportBackgroundError('board-log-disk', err);
    });
  });
}
