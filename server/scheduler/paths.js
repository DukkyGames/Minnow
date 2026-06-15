/**
 * Paths for scheduler persistence under ~/.minnow/.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Main job registry file. */
export function schedulerJobsPath() {
  return path.join(getMinnowHome(), 'scheduler.json');
}

/** Per-job run history directory. */
export function schedulerRunsDir() {
  return path.join(getMinnowHome(), 'scheduler-runs');
}

/** Run history file for a single job. */
export function schedulerRunHistoryPath(jobId) {
  return path.join(schedulerRunsDir(), `${jobId}.json`);
}

/** In-app notification queue for client polling. */
export function schedulerNotificationsPath() {
  return path.join(getMinnowHome(), 'scheduler-notifications.json');
}
