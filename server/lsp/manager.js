/**
 * LSP process manager — spawn stdio servers and collect diagnostics.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';
import { loadMergedLspConfig } from './config-loader.js';
import { matchServersForPath } from '../../src/lsp/merge-config.mjs';
import { formatDiagnostics } from '../../src/lsp/format-diagnostics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const processes = new Map();

function resolveCommand(command, args) {
  const cmd = command.map((part) => {
    if (part === 'test/fixtures/fake-lsp.mjs') {
      return path.join(PROJECT_ROOT, 'test/fixtures/fake-lsp.mjs');
    }
    return part;
  });
  return { command: cmd[0], args: cmd.slice(1) };
}

async function getConnection(serverId, config) {
  if (processes.has(serverId)) {
    return processes.get(serverId);
  }

  const command = config.command;
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error(
      `LSP server "${serverId}" has no command. Install the language server or set lsp.${serverId}.command in ~/.speedchat/lsp.json`,
    );
  }

  const { command: bin, args } = resolveCommand(command, config.args ?? []);
  const child = spawn(bin, args, {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });

  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );

  const state = {
    connection,
    child,
    diagnostics: new Map(),
    ready: false,
  };

  connection.onNotification('textDocument/publishDiagnostics', (params) => {
    if (params?.uri) {
      state.diagnostics.set(params.uri, params.diagnostics ?? []);
    }
  });

  connection.listen();
  await connection.sendRequest('initialize', {
    processId: process.pid,
    rootUri: `file://${PROJECT_ROOT.replace(/\\/g, '/')}`,
    capabilities: {},
  });
  connection.sendNotification('initialized', {});
  state.ready = true;
  processes.set(serverId, state);
  return state;
}

/**
 * Fetch formatted diagnostics for a project-relative path.
 */
export async function getLspDiagnostics(relativePath) {
  const merged = await loadMergedLspConfig();
  if (merged.enabled === false) {
    return 'Error: LSP is disabled in settings.';
  }

  const abs = path.resolve(PROJECT_ROOT, relativePath);
  const fileUri = `file://${abs.replace(/\\/g, '/')}`;
  const matchers = matchServersForPath(merged, relativePath);
  if (matchers.length === 0) {
    return `No LSP server configured for ${relativePath}.`;
  }

  const parts = [];
  for (const { id, config } of matchers) {
    try {
      const state = await getConnection(id, config);
      await state.connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: fileUri,
          languageId: 'typescript',
          version: 1,
          text: await import('node:fs/promises').then((fs) =>
            fs.readFile(abs, 'utf8').catch(() => ''),
          ),
        },
      });
      await new Promise((r) => setTimeout(r, 200));
      const diags = state.diagnostics.get(fileUri) ?? [];
      const formatted = formatDiagnostics(`${relativePath} (${id})`, diags);
      parts.push(formatted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      parts.push(`[${id}] Error: ${message}`);
    }
  }
  return parts.join('\n\n');
}

/** List configured servers and running state. */
export async function listLspServers() {
  const merged = await loadMergedLspConfig();
  return Object.entries(merged.lsp ?? {}).map(([id, cfg]) => ({
    id,
    label: cfg.label ?? id,
    disabled: cfg.disabled === true,
    running: processes.has(id),
    extensions: cfg.extensions ?? [],
  }));
}

export function shutdownAllLsp() {
  for (const [, state] of processes) {
    try {
      state.child.kill();
    } catch {
      /* ignore */
    }
  }
  processes.clear();
}
