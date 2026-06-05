/**
 * Managed local servers API bootstrap.
 */

import { autoStartEnabledServers, ensureServersLayout } from './manager.js';

export { createServersMiddleware } from './routes.js';
export {
  autoStartEnabledServers,
  getInstallStatus,
  getManagedSearxngUrl,
  getServerLogs,
  installServer,
  startInstallServer,
  listServers,
  restartServer,
  setServerAutoStart,
  setServerEnabled,
  setServerPort,
  shutdownAllServers,
  startServer,
  stopServer,
  uninstallServer,
} from './manager.js';
export { BUILTIN_SERVERS, getServerDef, listServerDefs } from './catalog.js';

/** Ensure ~/.minnow server layout and auto-start enabled installs. */
export async function initServersApi() {
  await ensureServersLayout();
  void autoStartEnabledServers();
}
