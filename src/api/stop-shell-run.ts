/**
 * Stop an agent shell run (blocking terminal SSE or background spawn).
 */

import { cancelTerminalRun } from './terminal';

/** Kill a shell process by run id. Returns true when the server accepted the cancel. */
export async function stopShellRun(runId: string): Promise<boolean> {
  if (!runId.trim()) return false;
  return cancelTerminalRun(runId.trim());
}
