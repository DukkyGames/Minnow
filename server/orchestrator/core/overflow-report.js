/** Overflow frequency over a journal. */

/**
 * @typedef {object} OverflowTaskRow
 * @property {string} taskId
 * @property {number} count
 */

/**
 * @typedef {object} OverflowFileRow
 * @property {string} path
 * @property {number} count
 */

/**
 * @typedef {object} TouchesOverflowReport
 * @property {number} eventCount
 * @property {OverflowTaskRow[]} tasks
 * @property {OverflowFileRow[]} files
 */

/**
 * Aggregate overflow events: how often, which tasks, which files.
 * @param {Iterable<{ type?: string, taskId?: string, actual?: unknown }>} events
 * @returns {TouchesOverflowReport}
 */
export function summarizeTouchesOverflow(events) {
  /** @type {Map<string, number>} */
  const byTask = new Map();
  /** @type {Map<string, number>} */
  const byFile = new Map();
  let eventCount = 0;

  for (const event of events ?? []) {
    if (event?.type !== 'touches.overflow') continue;
    eventCount += 1;
    const taskId = typeof event.taskId === 'string' && event.taskId ? event.taskId : '(unknown)';
    byTask.set(taskId, (byTask.get(taskId) ?? 0) + 1);
    const actual = Array.isArray(event.actual) ? event.actual : [];
    for (const file of actual) {
      if (typeof file !== 'string' || !file) continue;
      byFile.set(file, (byFile.get(file) ?? 0) + 1);
    }
  }

  const byCountThenId = (a, b) => b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  return {
    eventCount,
    tasks: [...byTask.entries()]
      .map(([taskId, count]) => ({ taskId, count }))
      .sort((a, b) => byCountThenId({ id: a.taskId, count: a.count }, { id: b.taskId, count: b.count })),
    files: [...byFile.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => byCountThenId({ id: a.path, count: a.count }, { id: b.path, count: b.count })),
  };
}
