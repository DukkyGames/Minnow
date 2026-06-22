/**
 * Wire the board log JSONL mirror to the local tool server.
 */

import { setBoardLogDiskSink } from './orchestrate-board-store.ts';
import type { BoardLogEvent } from '../types.ts';

/** Fire-and-forget POST of each log row to ~/.minnow/logs/orchestrate/<groupId>.jsonl. */
export function initBoardLogDiskSink(): void {
  setBoardLogDiskSink((groupId: string, event: BoardLogEvent) => {
    void fetch('/api/orchestrate/board-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, event }),
    }).catch(() => {
      /* mirror is best-effort */
    });
  });
}
