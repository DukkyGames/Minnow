/**
 * manage_dev_servers server tool — registry CRUD + lifecycle for workspace dev servers.
 */

import {
  createDevServer,
  deleteDevServer,
  getDevServerDefinition,
  readDevServers,
  updateDevServer,
} from './registry.js';
import {
  listDevServerStatuses,
  restartDevServerById,
  startDevServerById,
  stopDevServerById,
} from './manager.js';
import { validateAllowedWorkspaceRoot } from '../chats-workspace/paths.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * @param {unknown} value
 * @returns {boolean | undefined}
 */
function optionalBoolean(value) {
  if (typeof value === 'boolean') return value;
  return undefined;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function optionalNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Resolve and validate an optional worktree root for spawn overrides.
 * @param {unknown} value
 */
async function resolveWorktreeRoot(value) {
  const raw = optionalString(value);
  if (!raw) return undefined;
  try {
    return await validateAllowedWorkspaceRoot(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid worktreeRoot: ${message}`);
  }
}

/**
 * @param {Awaited<ReturnType<typeof listDevServerStatuses>>['servers'][number]} item
 */
function formatListRow(item) {
  const source = item.def?.source ?? 'user';
  const port = item.port != null ? ` port=${item.port}` : '';
  const network = item.network ? ` network=${item.network}` : '';
  const auto = item.def?.autoStart ? ' autoStart' : '';
  const cmd = item.command ? ` cmd="${item.command}"` : '';
  const err = item.error ? ` error="${item.error}"` : '';
  return `- ${item.name} (id=${item.id}, status=${item.status}, source=${source}${port}${network}${auto}${cmd}${err})`;
}

/**
 * @param {import('./registry.js').DevServerDefinition} def
 */
function formatDefinition(def) {
  return JSON.stringify(
    {
      id: def.id,
      name: def.name,
      command: def.command,
      cwd: def.cwd ?? '.',
      port: def.port,
      network: def.network,
      healthUrl: def.healthUrl ?? null,
      autoStart: def.autoStart ?? false,
      order: def.order ?? 0,
      worktreeRoot: def.worktreeRoot ?? null,
      source: def.source,
    },
    null,
    2,
  );
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolManageDevServers(args) {
  const action = String(args.action ?? 'list').trim().toLowerCase();
  const root = getEffectiveWorkspaceRoot();

  if (action === 'list') {
    const { servers } = await listDevServerStatuses(root);
    if (servers.length === 0) {
      return 'No dev servers registered. Use action=create or write startup.md at the workspace root.';
    }
    const lines = servers.map((item) => formatListRow(item));
    return `Dev servers (${servers.length}):\n${lines.join('\n')}`;
  }

  if (action === 'create') {
    const name = optionalString(args.name);
    const command = optionalString(args.command);
    if (!name) return 'Error: name is required for create';
    if (!command) return 'Error: command is required for create';

    let worktreeRoot;
    try {
      worktreeRoot = await resolveWorktreeRoot(args.worktreeRoot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }

    try {
      const created = await createDevServer(root, {
        id: optionalString(args.id),
        name,
        command,
        cwd: optionalString(args.cwd),
        port: optionalNumber(args.port),
        network: optionalString(args.network) === 'lan' ? 'lan' : optionalString(args.network) === 'local' ? 'local' : undefined,
        healthUrl: optionalString(args.healthUrl),
        autoStart: optionalBoolean(args.autoStart),
        order: optionalNumber(args.order),
        worktreeRoot,
      });
      return `Created dev server "${created.name}" (id=${created.id}).\n${formatDefinition(created)}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }

  if (action === 'update') {
    const id = optionalString(args.id);
    if (!id) return 'Error: id is required for update';

    const existing = await getDevServerDefinition(root, id);
    if (!existing) return `Error: dev server not found (${id})`;

    let worktreeRoot;
    if (args.worktreeRoot !== undefined) {
      try {
        worktreeRoot = await resolveWorktreeRoot(args.worktreeRoot);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    }

    const patch = {
      name: optionalString(args.name),
      command: optionalString(args.command),
      cwd: optionalString(args.cwd),
      port: optionalNumber(args.port),
      network:
        optionalString(args.network) === 'lan'
          ? 'lan'
          : optionalString(args.network) === 'local'
            ? 'local'
            : undefined,
      healthUrl: args.healthUrl !== undefined ? optionalString(args.healthUrl) : undefined,
      autoStart: optionalBoolean(args.autoStart),
      order: optionalNumber(args.order),
      worktreeRoot,
    };

    if (existing.source === 'startup.md') {
      if (patch.command || patch.cwd || patch.healthUrl !== undefined) {
        return 'Error: startup.md-linked servers only accept name, port, network, autoStart, order, and worktreeRoot. Edit startup.md for command/cwd/healthUrl.';
      }
    }

    try {
      const updated = await updateDevServer(root, id, patch);
      const note =
        updated.source === 'startup.md'
          ? ' Command/cwd/healthUrl remain authoritative from startup.md.'
          : '';
      return `Updated dev server "${updated.name}" (id=${updated.id}).${note}\n${formatDefinition(updated)}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }

  if (action === 'delete') {
    const id = optionalString(args.id);
    const confirmed = args.confirmed === true || args.confirm === true;
    if (!id) return 'Error: id is required for delete';
    if (!confirmed) {
      return 'Deletion requires confirmation. Re-run with confirmed: true after user approval.';
    }

    const existing = await getDevServerDefinition(root, id);
    if (!existing) return `Error: dev server not found (${id})`;
    if (existing.source === 'startup.md') {
      return 'Error: cannot delete startup.md-linked servers. Remove or edit startup.md instead.';
    }

    try {
      await stopDevServerById(root, id).catch(() => undefined);
      await deleteDevServer(root, id);
      return `Deleted dev server "${existing.name}" (${id}).`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }

  if (action === 'start' || action === 'stop' || action === 'restart') {
    const id = optionalString(args.id) ?? 'primary';

    let worktreeRoot;
    try {
      worktreeRoot = await resolveWorktreeRoot(args.worktreeRoot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }

    const existing = await getDevServerDefinition(root, id);
    if (!existing && id !== 'primary') {
      const all = await readDevServers(root);
      if (!all.some((s) => s.id === id)) {
        return `Error: dev server not found (${id})`;
      }
    }

    try {
      const result =
        action === 'start'
          ? await startDevServerById(root, id, { worktreeRoot })
          : action === 'stop'
            ? await stopDevServerById(root, id)
            : await restartDevServerById(root, id, { worktreeRoot });

      if (!result.ok) {
        return `Error: ${result.error ?? `${action} failed`}`;
      }

      return JSON.stringify(
        {
          ok: true,
          action,
          id,
          status: result.status,
          runId: result.runId ?? null,
          pid: result.pid ?? null,
          worktreeRoot: result.worktreeRoot ?? worktreeRoot ?? null,
          alreadyRunning: result.alreadyRunning ?? false,
        },
        null,
        2,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }

  return `Error: unknown action "${action}". Use list, create, update, delete, start, stop, or restart.`;
}
