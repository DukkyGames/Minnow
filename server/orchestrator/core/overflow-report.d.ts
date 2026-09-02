export interface OverflowTaskRow {
  taskId: string;
  count: number;
}

export interface OverflowFileRow {
  path: string;
  count: number;
}

export interface TouchesOverflowReport {
  eventCount: number;
  tasks: OverflowTaskRow[];
  files: OverflowFileRow[];
}

/**
 * Aggregate `touches.overflow` events: frequency and the files that overflow most often.
 */
export function summarizeTouchesOverflow(
  events: Iterable<{ type?: string; taskId?: string; actual?: unknown }>,
): TouchesOverflowReport;
