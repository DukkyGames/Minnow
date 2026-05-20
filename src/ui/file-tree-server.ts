/**
 * Local server availability for the file tree (avoids importing tools/client in tests).
 */

let localServerAvailable = false;

/** Mirror detectLocalServer() result for tree CRUD and browse. */
export function setFileTreeServerAvailable(available: boolean): void {
  localServerAvailable = available;
}

export function isFileTreeServerAvailable(): boolean {
  return localServerAvailable;
}
