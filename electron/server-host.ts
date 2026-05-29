/**
 * In-process HTTP server for packaged Electron (MIN-111).
 * Stub until Connect + sirv + PTY WS host is implemented.
 */

export interface InProcessServerHandle {
  url: string;
  close(): Promise<void>;
}

/**
 * Start Minnow API + static dist on a dynamic localhost port (production Electron).
 */
export async function startInProcessServer(): Promise<InProcessServerHandle> {
  throw new Error(
    'In-process server is not implemented yet (MIN-111). Use npm run electron:dev for development.',
  );
}
