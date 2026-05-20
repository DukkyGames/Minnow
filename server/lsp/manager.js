/**
 * LSP process manager — spawn stdio servers, document sync, diagnostics, completion.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';
import { getBuiltinLspIds, loadMergedLspConfig } from './config-loader.js';
import { matchServersForPath } from '../../src/lsp/merge-config.mjs';
import { formatDiagnostics } from '../../src/lsp/format-diagnostics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const processes = new Map();

/** Per-fileUri sync state: LSP version + latest full text. */
const documentSync = new Map();

function resolveCommand(command) {
  const cmd = command.map((part) => {
    if (part === 'test/fixtures/fake-lsp.mjs') {
      return path.join(PROJECT_ROOT, 'test/fixtures/fake-lsp.mjs');
    }
    return part;
  });
  return { command: cmd[0], args: cmd.slice(1) };
}

function toFileUri(relativePath) {
  const abs = path.resolve(PROJECT_ROOT, relativePath);
  return `file://${abs.replace(/\\/g, '/')}`;
}

/** Map file extension to LSP languageId for didOpen. */
function guessLanguageId(relativePath) {
  const ext = relativePath.includes('.')
    ? relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
    : '';
  const map = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.json': 'json',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.css': 'css',
    '.html': 'html',
    '.htm': 'html',
    '.py': 'python',
    '.pyi': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.fake': 'fake',
  };
  return map[ext] ?? 'plaintext';
}

function normalizeCompletionItems(result) {
  const raw = Array.isArray(result) ? result : (result?.items ?? []);
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label ?? '');
    if (!label) continue;
    out.push({
      label,
      insertText: String(item.insertText ?? item.label ?? ''),
      kind: typeof item.kind === 'number' ? item.kind : undefined,
      detail: item.detail != null ? String(item.detail) : undefined,
    });
  }
  return out;
}

async function getConnection(serverId, config) {
  if (processes.has(serverId)) {
    return processes.get(serverId);
  }

  const command = config.command;
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error(
      `LSP server "${serverId}" has no command. Install the language server or set lsp.${serverId}.command in ~/.minnow/lsp.json`,
    );
  }

  const { command: bin, args } = resolveCommand(command);
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
    capabilities: {
      textDocument: {
        completion: {
          completionItem: {
            snippetSupport: true,
          },
        },
      },
    },
  });
  connection.sendNotification('initialized', {});
  state.ready = true;
  processes.set(serverId, state);
  return state;
}

/**
 * Sync document lifecycle with LSP servers (didOpen / didChange / didClose).
 */
export async function notifyLspDocument(relativePath, event, text) {
  const merged = await loadMergedLspConfig();
  if (merged.enabled === false) {
    return { ok: false, error: 'LSP is disabled' };
  }

  if (!relativePath || relativePath.includes('..')) {
    return { ok: false, error: 'Invalid path' };
  }

  const fileUri = toFileUri(relativePath);
  const matchers = matchServersForPath(merged, relativePath);
  if (matchers.length === 0) {
    return { ok: false, error: `No LSP server configured for ${relativePath}` };
  }

  if (event === 'open') {
    const body = text ?? '';
    documentSync.set(fileUri, { version: 1, text: body });
    for (const { id, config } of matchers) {
      const state = await getConnection(id, config);
      await state.connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: fileUri,
          languageId: guessLanguageId(relativePath),
          version: 1,
          text: body,
        },
      });
    }
    return { ok: true };
  }

  if (event === 'change') {
    const prev = documentSync.get(fileUri) ?? { version: 0, text: '' };
    const nextVersion = prev.version + 1;
    const nextText = text ?? prev.text;
    documentSync.set(fileUri, { version: nextVersion, text: nextText });
    for (const { id, config } of matchers) {
      const state = await getConnection(id, config);
      await state.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: fileUri, version: nextVersion },
        contentChanges: [{ text: nextText }],
      });
    }
    return { ok: true };
  }

  if (event === 'close') {
    documentSync.delete(fileUri);
    for (const { id, config } of matchers) {
      const state = await getConnection(id, config);
      await state.connection.sendNotification('textDocument/didClose', {
        textDocument: { uri: fileUri },
      });
    }
    return { ok: true };
  }

  return { ok: false, error: 'Invalid event' };
}

/**
 * Request completion items at a 0-based line/character position.
 */
export async function getLspCompletions(relativePath, line, character) {
  const merged = await loadMergedLspConfig();
  if (merged.enabled === false) {
    return { items: [], error: 'LSP is disabled' };
  }

  if (!relativePath || relativePath.includes('..')) {
    return { items: [], error: 'Invalid path' };
  }

  const fileUri = toFileUri(relativePath);
  const matchers = matchServersForPath(merged, relativePath);
  if (matchers.length === 0) {
    return { items: [], error: `No LSP server configured for ${relativePath}` };
  }

  if (!documentSync.has(fileUri)) {
    const fs = await import('node:fs/promises');
    const abs = path.resolve(PROJECT_ROOT, relativePath);
    const diskText = await fs.readFile(abs, 'utf8').catch(() => '');
    await notifyLspDocument(relativePath, 'open', diskText);
  }

  const seen = new Set();
  const items = [];

  for (const { id, config } of matchers) {
    try {
      const state = await getConnection(id, config);
      const result = await state.connection.sendRequest('textDocument/completion', {
        textDocument: { uri: fileUri },
        position: { line, character },
      });
      for (const item of normalizeCompletionItems(result)) {
        if (seen.has(item.label)) continue;
        seen.add(item.label);
        items.push(item);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { items, error: `[${id}] ${message}` };
    }
  }

  return { items };
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
  const fileUri = toFileUri(relativePath);
  const matchers = matchServersForPath(merged, relativePath);
  if (matchers.length === 0) {
    return `No LSP server configured for ${relativePath}.`;
  }

  const parts = [];
  for (const { id, config } of matchers) {
    try {
      const state = await getConnection(id, config);
      const fs = await import('node:fs/promises');
      const text = await fs.readFile(abs, 'utf8').catch(() => '');
      await notifyLspDocument(relativePath, 'open', text);
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
  const builtinIds = await getBuiltinLspIds();
  return Object.entries(merged.lsp ?? {}).map(([id, cfg]) => ({
    id,
    label: cfg.label ?? id,
    disabled: cfg.disabled === true,
    running: processes.has(id),
    extensions: cfg.extensions ?? [],
    builtin: builtinIds.has(id),
    hasCommand: Array.isArray(cfg.command) && cfg.command.length > 0,
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
  documentSync.clear();
}
