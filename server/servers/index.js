/**
 * Managed local servers API bootstrap.
 */

import { autoProvisionEnabledServers, autoStartEnabledServers, ensureServersLayout, reapOrphanedServers } from './manager.js';

export { createServersMiddleware } from './routes.js';
export {
  autoProvisionEnabledServers,
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
  reapOrphanedServers,
  shutdownAllServers,
  shutdownAllServersNow,
  startServer,
  stopServer,
  uninstallServer,
} from './manager.js';
export { BUILTIN_SERVERS, getServerDef, listServerDefs } from './catalog.js';

/** Ensure ~/.minnow server layout and auto-start enabled installs. */
export async function initServersApi() {
  await ensureServersLayout();
  await reapOrphanedServers();
  void autoStartEnabledServers();
  void autoProvisionEnabledServers();
}
