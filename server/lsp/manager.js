/**
 * LSP process manager — spawn stdio servers, document sync, diagnostics, completion.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';
import { getBuiltinLspIds, loadMergedLspConfig } from './config-loader.js';
import { getBundledTsserverPath, resolveLspSpawnArgv } from './resolve-command.js';
import { buildLspProcessEnv } from './paths.js';
import {
  matchServersForPath,
  serverSupportsWorkspaceSymbols,
} from '../../src/lsp/merge-config.mjs';
import { formatDiagnostics } from '../../src/lsp/format-diagnostics.mjs';
import { getWorkspaceRoot } from '../workspace/root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '../..');

const processes = new Map();

/** In-flight connect attempts (dedupe parallel spawns for the same server id). */
const pendingConnections = new Map();

/** Per-fileUri sync state: LSP version + latest full text. */
const documentSync = new Map();

function workspaceRootUri() {
  return pathToFileURL(getWorkspaceRoot()).href;
}

function toFileUri(relativePath) {
  const abs = path.resolve(getWorkspaceRoot(), relativePath);
  return pathToFileURL(abs).href;
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
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.sh': 'shellscript',
    '.bash': 'shellscript',
    '.zsh': 'shellscript',
    '.ksh': 'shellscript',
    '.dockerfile': 'dockerfile',
    '.graphql': 'graphql',
    '.gql': 'graphql',
    '.php': 'php',
    '.java': 'java',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.rb': 'ruby',
    '.lua': 'lua',
    '.zig': 'zig',
    '.zon': 'zig',
    '.tf': 'terraform',
    '.tfvars': 'terraform',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.astro': 'astro',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.scala': 'scala',
    '.sql': 'sql',
    '.xml': 'xml',
    '.svg': 'xml',
    '.dart': 'dart',
    '.fake': 'fake',
  };
  const base = path.basename(relativePath);
  if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) {
    return 'dockerfile';
  }
  return map[ext] ?? 'plaintext';
}

function normalizeDocumentation(doc) {
  if (doc == null) return undefined;
  if (typeof doc === 'string') return doc;
  if (typeof doc === 'object' && doc.value != null) {
    return {
      kind: doc.kind === 'markdown' ? 'markdown' : 'plaintext',
      value: String(doc.value),
    };
  }
  return undefined;
}

function normalizeLspRange(range) {
  if (!range || typeof range !== 'object' || !range.start) return undefined;
  const start = range.start;
  const end = range.end ?? start;
  return {
    start: {
      line: Number(start.line ?? 0),
      character: Number(start.character ?? 0),
    },
    end: {
      line: Number(end.line ?? start.line ?? 0),
      character: Number(end.character ?? start.character ?? 0),
    },
  };
}

/** Project-relative path from an LSP file URI (falls back to the raw URI). */
function fileUriToRelativePath(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    const abs = fileURLToPath(uri);
    const root = path.resolve(getWorkspaceRoot());
    const rel = path.relative(root, abs);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return rel.replace(/\\/g, '/');
    }
  } catch {
    /* ignore invalid URIs */
  }
  return uri;
}

/** Normalize one documentSymbol or legacy SymbolInformation node. */
function normalizeDocumentSymbol(symbol) {
  if (!symbol || typeof symbol !== 'object') return null;
  const name = String(symbol.name ?? '');
  if (!name) return null;

  if (symbol.location && !symbol.selectionRange) {
    const loc = symbol.location;
    return {
      name,
      kind: typeof symbol.kind === 'number' ? symbol.kind : 0,
      range: normalizeLspRange(loc.range),
      selectionRange: normalizeLspRange(loc.range),
      containerName:
        symbol.containerName != null ? String(symbol.containerName) : undefined,
      children: [],
    };
  }

  const entry = {
    name,
    kind: typeof symbol.kind === 'number' ? symbol.kind : 0,
    range: normalizeLspRange(symbol.range),
    selectionRange: normalizeLspRange(symbol.selectionRange ?? symbol.range),
  };
  if (symbol.detail != null) entry.detail = String(symbol.detail);
  if (Array.isArray(symbol.children) && symbol.children.length > 0) {
    const children = symbol.children.map(normalizeDocumentSymbol).filter(Boolean);
    if (children.length > 0) entry.children = children;
  }
  return entry;
}

/** Normalize workspace/symbol result for the code index. */
function normalizeWorkspaceSymbol(symbol) {
  if (!symbol || typeof symbol !== 'object') return null;
  const name = String(symbol.name ?? '');
  if (!name) return null;
  const loc = symbol.location ?? {};
  const uri = loc.uri ?? symbol.uri ?? '';
  return {
    name,
    kind: typeof symbol.kind === 'number' ? symbol.kind : 0,
    path: fileUriToRelativePath(String(uri)),
    range: normalizeLspRange(loc.range ?? symbol.range),
    containerName:
      symbol.containerName != null ? String(symbol.containerName) : undefined,
  };
}

/** Normalize call-hierarchy item (prepareCallHierarchy / incoming / outgoing). */
function normalizeCallHierarchyItem(item) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name ?? '');
  if (!name) return null;
  const normalized = {
    name,
    kind: typeof item.kind === 'number' ? item.kind : 0,
    path: fileUriToRelativePath(String(item.uri ?? '')),
    range: normalizeLspRange(item.range),
    selectionRange: normalizeLspRange(item.selectionRange ?? item.range),
  };
  if (item.data !== undefined) normalized.data = item.data;
  return normalized;
}

function normalizeIncomingCalls(calls) {
  if (!Array.isArray(calls)) return [];
  const out = [];
  for (const call of calls) {
    if (!call || typeof call !== 'object') continue;
    const from = normalizeCallHierarchyItem(call.from);
    if (!from) continue;
    out.push({
      from,
      fromRanges: (call.fromRanges ?? [])
        .map(normalizeLspRange)
        .filter(Boolean),
    });
  }
  return out;
}

function normalizeOutgoingCalls(calls) {
  if (!Array.isArray(calls)) return [];
  const out = [];
  for (const call of calls) {
    if (!call || typeof call !== 'object') continue;
    const to = normalizeCallHierarchyItem(call.to);
    if (!to) continue;
    out.push({
      to,
      fromRanges: (call.fromRanges ?? [])
        .map(normalizeLspRange)
        .filter(Boolean),
    });
  }
  return out;
}

/** Prefer textEdit / insert-replace ranges over bare insertText. */
function extractCompletionInsertFields(item) {
  let insertText = String(item.insertText ?? item.label ?? '');
  let textEditRange;
  let textEditInsertRange;
  let textEditReplaceRange;
  const te = item.textEdit;
  if (te && typeof te === 'object') {
    if (te.insert != null && te.replace != null) {
      insertText = String(te.newText ?? insertText);
      textEditInsertRange = normalizeLspRange(te.insert);
      textEditReplaceRange = normalizeLspRange(te.replace);
      textEditRange = textEditReplaceRange;
    } else if (te.range != null && te.newText != null) {
      insertText = String(te.newText);
      textEditRange = normalizeLspRange(te.range);
    } else if (te.replace != null) {
      insertText = String(te.newText ?? insertText);
      textEditRange = normalizeLspRange(te.replace);
    }
  }
  return { insertText, textEditRange, textEditInsertRange, textEditReplaceRange };
}

function normalizeCompletionItems(result) {
  const raw = Array.isArray(result) ? result : (result?.items ?? []);
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label ?? '');
    if (!label) continue;
    const { insertText, textEditRange, textEditInsertRange, textEditReplaceRange } =
      extractCompletionInsertFields(item);
    const entry = {
      label,
      insertText,
      kind: typeof item.kind === 'number' ? item.kind : undefined,
      detail: item.detail != null ? String(item.detail) : undefined,
    };
    if (textEditRange) entry.textEditRange = textEditRange;
    if (textEditInsertRange) entry.textEditInsertRange = textEditInsertRange;
    if (textEditReplaceRange) entry.textEditReplaceRange = textEditReplaceRange;
    const documentation = normalizeDocumentation(item.documentation);
    if (documentation !== undefined) entry.documentation = documentation;
    if (item.data !== undefined) entry.data = item.data;
    if (typeof item.insertTextFormat === 'number') {
      entry.insertTextFormat = item.insertTextFormat;
    }
    if (Array.isArray(item.additionalTextEdits) && item.additionalTextEdits.length > 0) {
      entry.additionalTextEdits = item.additionalTextEdits;
    }
    out.push(entry);
  }
  return out;
}

function normalizeStructuredDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) return [];
  const out = [];
  for (const d of diagnostics) {
    if (!d || typeof d !== 'object') continue;
    const start = d.range?.start ?? {};
    const end = d.range?.end ?? start;
    out.push({
      message: String(d.message ?? ''),
      severity: typeof d.severity === 'number' ? d.severity : 1,
      source: d.source != null ? String(d.source) : undefined,
      code: d.code != null ? String(d.code) : undefined,
      range: {
        start: {
          line: Number(start.line ?? 0),
          character: Number(start.character ?? 0),
        },
        end: {
          line: Number(end.line ?? start.line ?? 0),
          character: Number(end.character ?? start.character ?? 0),
        },
      },
    });
  }
  return out;
}

function formatLspSpawnError(serverId, bin, err) {
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
  if (code === 'ENOENT') {
    return (
      `LSP server "${serverId}" not found: "${bin}". ` +
      `Run npm install in the Minnow app folder, or disable "${serverId}" under Settings → Language servers.`
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return `LSP server "${serverId}" failed to start: ${message}`;
}

/** Wait for spawn success; reject on ENOENT and other spawn failures (avoids unhandled 'error'). */
function spawnLspChild(argv) {
  const [bin, ...args] = argv;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: getWorkspaceRoot(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      env: buildLspProcessEnv({
        ...process.env,
        MINNOW_APP_ROOT: APP_ROOT,
      }),
    });
    /** @type {string[]} */
    const stderrLines = [];
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderrLines.push(text);
      if (text.trim()) {
        console.error(`[lsp] stderr: ${text.trimEnd()}`);
      }
    });
    child.stderrLines = stderrLines;
    child.once('error', reject);
    child.once('spawn', () => resolve(child));
  });
}

/** LSP initialize options for built-in TypeScript (TLS v4+ uses init, not CLI flags). */
function typescriptInitializationOptions() {
  return {
    tsserver: {
      fallbackPath: getBundledTsserverPath(),
    },
    typescript: {
      implicitProjectConfiguration: {
        checkJs: true,
        module: 'ESNext',
        target: 'ES2022',
      },
    },
  };
}

/** Benign workspace/symbol failures — skip instead of surfacing to callers. */
function isSkippableWorkspaceSymbolError(message) {
  const text = String(message ?? '');
  if (/Unhandled method workspace\/symbol/i.test(text)) return true;
  if (/connection got disposed/i.test(text)) return true;
  return false;
}

/** User-facing hint when TypeScript has no loaded project for workspace search. */
function formatWorkspaceSymbolErrors(errors) {
  const joined = errors.join('; ');
  if (/No Project/i.test(joined)) {
    return `${joined} — add tsconfig.json or jsconfig.json at the workspace root (or reindex so Minnow can create .minnow/jsconfig.json), then try again.`;
  }
  return joined;
}

function discardLspState(serverId, state) {
  processes.delete(serverId);
  try {
    state.connection?.dispose?.();
  } catch {
    /* ignore */
  }
  try {
    state.child?.kill();
  } catch {
    /* ignore */
  }
}

function bindLspProcessLifecycle(serverId, state) {
  state.child.on('error', (err) => {
    console.error(`[lsp] ${serverId}:`, err instanceof Error ? err.message : err);
    discardLspState(serverId, state);
  });
  state.child.on('exit', (code, signal) => {
    if (code !== 0 && code != null) {
      const detail = state.child.stderrLines?.join('').trim();
      console.error(
        `[lsp] ${serverId} exited with code ${code}${detail ? `: ${detail}` : ''}`,
      );
    } else if (signal) {
      console.error(`[lsp] ${serverId} exited on signal ${signal}`);
    }
    discardLspState(serverId, state);
  });
}

async function connectLspServer(serverId, config) {
  const command = config.command;
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error(
      `LSP server "${serverId}" has no command. Install the language server or set lsp.${serverId}.command in ~/.minnow/lsp.json`,
    );
  }

  const { argv, displayBin } = resolveLspSpawnArgv(command);
  if (argv.length === 0) {
    throw new Error(
      `LSP server "${serverId}" has no command. Run npm install in the Minnow app folder or set lsp.${serverId}.command in ~/.minnow/lsp.json`,
    );
  }
  let child;
  try {
    child = await spawnLspChild(argv);
  } catch (err) {
    throw new Error(formatLspSpawnError(serverId, displayBin, err));
  }

  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );

  const state = {
    connection,
    child,
    diagnostics: new Map(),
    ready: false,
    serverCapabilities: {},
  };

  connection.onNotification('textDocument/publishDiagnostics', (params) => {
    if (params?.uri) {
      state.diagnostics.set(params.uri, params.diagnostics ?? []);
    }
  });

  bindLspProcessLifecycle(serverId, state);

  try {
    connection.listen();
    const initResult = await connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: workspaceRootUri(),
      ...(serverId === 'typescript'
        ? { initializationOptions: typescriptInitializationOptions() }
        : {}),
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          typeDefinition: { linkSupport: true },
          references: {},
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: { labelOffsetSupport: true },
            },
          },
          completion: {
            completionItem: {
              snippetSupport: true,
              insertReplaceSupport: true,
              resolveSupport: {
                properties: ['documentation', 'detail', 'additionalTextEdits'],
              },
            },
          },
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
          },
          callHierarchy: {},
        },
        workspace: {
          symbol: {},
        },
      },
    });
    state.serverCapabilities =
      initResult && typeof initResult === 'object' && initResult.capabilities
        ? initResult.capabilities
        : {};
    connection.sendNotification('initialized', {});
    state.ready = true;
    return state;
  } catch (err) {
    discardLspState(serverId, state);
    throw err;
  }
}

async function getConnection(serverId, config) {
  if (processes.has(serverId)) {
    return processes.get(serverId);
  }
  if (pendingConnections.has(serverId)) {
    return pendingConnections.get(serverId);
  }

  const connectPromise = connectLspServer(serverId, config).then((state) => {
    processes.set(serverId, state);
    return state;
  });
  pendingConnections.set(serverId, connectPromise);
  try {
    return await connectPromise;
  } finally {
    pendingConnections.delete(serverId);
  }
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
    const existing = documentSync.get(fileUri);
    if (existing) {
      if (existing.text === body) {
        return { ok: true };
      }
      const nextVersion = existing.version + 1;
      documentSync.set(fileUri, { version: nextVersion, text: body });
      for (const { id, config } of matchers) {
        const state = await getConnection(id, config);
        await state.connection.sendNotification('textDocument/didChange', {
          textDocument: { uri: fileUri, version: nextVersion },
          contentChanges: [{ text: body }],
        });
      }
      return { ok: true };
    }
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
 * Ensure the LSP has the latest buffer for a path.
 * @param {string} relativePath
 * @param {{ editorText?: string }} [options] - When set (e.g. from CM6), never fall back to disk.
 */
async function ensureDocumentSynced(relativePath, options = {}) {
  const fileUri = toFileUri(relativePath);
  const synced = documentSync.get(fileUri);
  if (synced) {
    if (options.editorText !== undefined && options.editorText !== synced.text) {
      await notifyLspDocument(relativePath, 'change', options.editorText);
    }
    return fileUri;
  }
  let body = options.editorText;
  if (body === undefined) {
    const fs = await import('node:fs/promises');
    const abs = path.resolve(getWorkspaceRoot(), relativePath);
    body = await fs.readFile(abs, 'utf8').catch(() => '');
  }
  await notifyLspDocument(relativePath, 'open', body);
  return fileUri;
}

/** Brief wait for publishDiagnostics after the document is already synced. */
async function awaitPublishedDiagnostics() {
  await new Promise((r) => setTimeout(r, 200));
}

async function withLspMatchers(relativePath, handler, options = {}) {
  const merged = await loadMergedLspConfig();
  if (merged.enabled === false) {
    return { ok: false, error: 'LSP is disabled' };
  }
  if (!relativePath || relativePath.includes('..')) {
    return { ok: false, error: 'Invalid path' };
  }
  const matchers = matchServersForPath(merged, relativePath);
  if (matchers.length === 0) {
    return { ok: false, error: `No LSP server configured for ${relativePath}` };
  }
  const fileUri = await ensureDocumentSynced(relativePath, options);
  return handler({ merged, matchers, fileUri });
}

/** All configured, non-disabled language servers (for workspace-wide queries). */
async function withAllLspServers(handler) {
  const merged = await loadMergedLspConfig();
  if (merged.enabled === false) {
    return { ok: false, error: 'LSP is disabled' };
  }
  const servers = Object.entries(merged.lsp ?? {})
    .filter(
      ([, cfg]) =>
        cfg.disabled !== true &&
        Array.isArray(cfg.command) &&
        cfg.command.length > 0,
    )
    .map(([id, config]) => ({ id, config }));
  if (servers.length === 0) {
    return { ok: false, error: 'No LSP servers configured' };
  }
  return handler({ merged, servers });
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

  await ensureDocumentSynced(relativePath);

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

  const fileUri = toFileUri(relativePath);
  const matchers = matchServersForPath(merged, relativePath);
  if (matchers.length === 0) {
    return `No LSP server configured for ${relativePath}.`;
  }

  try {
    await ensureDocumentSynced(relativePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }

  const parts = [];
  for (const { id, config } of matchers) {
    try {
      const state = await getConnection(id, config);
      await awaitPublishedDiagnostics();
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

/**
 * Raw LSP diagnostics for a path (not LLM-formatted).
 * @param {string} relativePath
 * @param {string} [editorText] - Current editor buffer; avoids disk fallback when provided.
 */
export async function getLspStructuredDiagnostics(relativePath, editorText) {
  const syncOpts =
    typeof editorText === 'string' ? { editorText } : {};
  const ctx = await withLspMatchers(
    relativePath,
    async ({ matchers, fileUri }) => ({
      ok: true,
      matchers,
      fileUri,
    }),
    syncOpts,
  );
  if (!ctx.ok) {
    return { diagnostics: [], error: ctx.error };
  }

  const parts = [];
  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      await awaitPublishedDiagnostics();
      const diags = state.diagnostics.get(ctx.fileUri) ?? [];
      parts.push(...normalizeStructuredDiagnostics(diags));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { diagnostics: parts, error: `[${id}] ${message}` };
    }
  }
  return { diagnostics: parts };
}

/**
 * Hover contents at a 0-based position (first matching server wins).
 */
export async function getLspHover(relativePath, line, character) {
  const ctx = await withLspMatchers(relativePath, async ({ matchers, fileUri }) => ({
    ok: true,
    matchers,
    fileUri,
  }));
  if (!ctx.ok) {
    return { hover: null, error: ctx.error };
  }

  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      const hover = await state.connection.sendRequest('textDocument/hover', {
        textDocument: { uri: ctx.fileUri },
        position: { line, character },
      });
      return { hover: hover ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { hover: null, error: `[${id}] ${message}` };
    }
  }
  return { hover: null };
}

/**
 * Go-to-definition at a 0-based position (first non-null result).
 */
export async function getLspDefinition(relativePath, line, character) {
  const ctx = await withLspMatchers(relativePath, async ({ matchers, fileUri }) => ({
    ok: true,
    matchers,
    fileUri,
  }));
  if (!ctx.ok) {
    return { locations: [], error: ctx.error };
  }

  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      const result = await state.connection.sendRequest('textDocument/definition', {
        textDocument: { uri: ctx.fileUri },
        position: { line, character },
      });
      if (result != null) {
        return { locations: result };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { locations: [], error: `[${id}] ${message}` };
    }
  }
  return { locations: [] };
}

/** Type definition — same shape as definition. */
export async function getLspTypeDefinition(relativePath, line, character) {
  const ctx = await withLspMatchers(relativePath, async ({ matchers, fileUri }) => ({
    ok: true,
    matchers,
    fileUri,
  }));
  if (!ctx.ok) {
    return { locations: [], error: ctx.error };
  }

  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      const result = await state.connection.sendRequest('textDocument/typeDefinition', {
        textDocument: { uri: ctx.fileUri },
        position: { line, character },
      });
      if (result != null) {
        return { locations: result };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { locations: [], error: `[${id}] ${message}` };
    }
  }
  return { locations: [] };
}

/** Find references at a 0-based position. */
export async function getLspReferences(relativePath, line, character) {
  const ctx = await withLspMatchers(relativePath, async ({ matchers, fileUri }) => ({
    ok: true,
    matchers,
    fileUri,
  }));
  if (!ctx.ok) {
    return { locations: [], error: ctx.error };
  }

  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      const result = await state.connection.sendRequest('textDocument/references', {
        textDocument: { uri: ctx.fileUri },
        position: { line, character },
        context: { includeDeclaration: true },
      });
      return { locations: Array.isArray(result) ? result : [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { locations: [], error: `[${id}] ${message}` };
    }
  }
  return { locations: [] };
}

/**
 * Signature help at a 0-based position.
 */
export async function getLspSignatureHelp(relativePath, line, character) {
  const ctx = await withLspMatchers(relativePath, async ({ matchers, fileUri }) => ({
    ok: true,
    matchers,
    fileUri,
  }));
  if (!ctx.ok) {
    return { signatureHelp: null, error: ctx.error };
  }

  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      const signatureHelp = await state.connection.sendRequest(
        'textDocument/signatureHelp',
        {
          textDocument: { uri: ctx.fileUri },
          position: { line, character },
        },
      );
      return { signatureHelp: signatureHelp ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { signatureHelp: null, error: `[${id}] ${message}` };
    }
  }
  return { signatureHelp: null };
}

/**
 * Document symbol tree for a project-relative path (textDocument/documentSymbol).
 */
export async function getLspDocumentSymbols(relativePath) {
  const ctx = await withLspMatchers(relativePath, async ({ matchers, fileUri }) => ({
    ok: true,
    matchers,
    fileUri,
  }));
  if (!ctx.ok) {
    return { symbols: [], error: ctx.error };
  }

  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      const result = await state.connection.sendRequest('textDocument/documentSymbol', {
        textDocument: { uri: ctx.fileUri },
      });
      const raw = Array.isArray(result) ? result : [];
      const symbols = raw.map(normalizeDocumentSymbol).filter(Boolean);
      return { symbols };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { symbols: [], error: `[${id}] ${message}` };
    }
  }
  return { symbols: [] };
}

/**
 * Workspace-wide symbol search (workspace/symbol) across all configured servers.
 */
export async function getLspWorkspaceSymbols(query) {
  const q = String(query ?? '');
  const ctx = await withAllLspServers(async ({ servers }) => ({ ok: true, servers }));
  if (!ctx.ok) {
    return { symbols: [], error: ctx.error };
  }

  const seen = new Set();
  const symbols = [];
  const errors = [];
  for (const { id, config } of ctx.servers) {
    try {
      const state = await getConnection(id, config);
      if (!serverSupportsWorkspaceSymbols(id, config, state.serverCapabilities)) {
        continue;
      }
      const result = await state.connection.sendRequest('workspace/symbol', {
        query: q,
      });
      const raw = Array.isArray(result) ? result : [];
      for (const sym of raw) {
        const normalized = normalizeWorkspaceSymbol(sym);
        if (!normalized) continue;
        const key = `${normalized.path}:${normalized.name}:${normalized.range?.start?.line ?? 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        symbols.push(normalized);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isSkippableWorkspaceSymbolError(message)) continue;
      errors.push(`[${id}] ${message}`);
    }
  }
  if (symbols.length === 0 && errors.length > 0) {
    return { symbols: [], error: formatWorkspaceSymbolErrors(errors) };
  }
  return { symbols, ...(errors.length > 0 ? { warnings: errors } : {}) };
}

/**
 * Call hierarchy at a 0-based position — prepare + incoming + outgoing calls.
 */
export async function getLspCallHierarchy(relativePath, line, character) {
  const ctx = await withLspMatchers(relativePath, async ({ matchers, fileUri }) => ({
    ok: true,
    matchers,
    fileUri,
  }));
  if (!ctx.ok) {
    return {
      item: null,
      incomingCalls: [],
      outgoingCalls: [],
      error: ctx.error,
    };
  }

  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      const prepared = await state.connection.sendRequest(
        'textDocument/prepareCallHierarchy',
        {
          textDocument: { uri: ctx.fileUri },
          position: { line, character },
        },
      );
      const items = Array.isArray(prepared) ? prepared : prepared ? [prepared] : [];
      if (items.length === 0) {
        return { item: null, incomingCalls: [], outgoingCalls: [] };
      }
      const rawItem = items[0];
      const [incomingRaw, outgoingRaw] = await Promise.all([
        state.connection.sendRequest('callHierarchy/incomingCalls', {
          item: rawItem,
        }),
        state.connection.sendRequest('callHierarchy/outgoingCalls', {
          item: rawItem,
        }),
      ]);
      return {
        item: normalizeCallHierarchyItem(rawItem),
        incomingCalls: normalizeIncomingCalls(incomingRaw),
        outgoingCalls: normalizeOutgoingCalls(outgoingRaw),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        item: null,
        incomingCalls: [],
        outgoingCalls: [],
        error: `[${id}] ${message}`,
      };
    }
  }
  return { item: null, incomingCalls: [], outgoingCalls: [] };
}

/**
 * Resolve a completion item (documentation, additionalTextEdits).
 */
export async function resolveLspCompletion(relativePath, item) {
  const ctx = await withLspMatchers(relativePath, async ({ matchers, fileUri }) => ({
    ok: true,
    matchers,
    fileUri,
  }));
  if (!ctx.ok) {
    return { item: null, error: ctx.error };
  }
  if (!item || typeof item !== 'object') {
    return { item: null, error: 'Invalid completion item' };
  }

  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      const resolved = await state.connection.sendRequest('completionItem/resolve', item);
      const [normalized] = normalizeCompletionItems([resolved]);
      return { item: normalized ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { item: null, error: `[${id}] ${message}` };
    }
  }
  return { item: null };
}

/** Human-readable install hint from defaults requirements block. */
function formatRequirements(requirements) {
  if (!requirements || typeof requirements !== 'object') return undefined;
  const bits = [];
  if (requirements.package) {
    bits.push(`npm package ${requirements.package}`);
  }
  if (requirements.binary) {
    bits.push(`binary ${requirements.binary}`);
  }
  if (requirements.command) {
    bits.push(`command ${requirements.command}`);
  }
  if (bits.length === 0) return undefined;
  return `Requires: ${bits.join(', ')}`;
}

/** Single-line explanation for settings UI (disable, no command, tooling). */
function deriveDisabledReason(cfg, { disabled, hasCommand, running }) {
  if (running) return undefined;
  const parts = [];
  if (disabled) {
    parts.push('Disabled in settings');
  }
  if (!hasCommand && !disabled) {
    parts.push(
      'No command configured — add command in ~/.minnow/lsp.json or install tooling',
    );
  }
  const reqLine = formatRequirements(cfg.requirements);
  if (reqLine) parts.push(reqLine);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** List configured servers and running state. */
export async function listLspServers() {
  const merged = await loadMergedLspConfig();
  const builtinIds = await getBuiltinLspIds();
  return Object.entries(merged.lsp ?? {}).map(([id, cfg]) => {
    const disabled = cfg.disabled === true;
    const hasCommand = Array.isArray(cfg.command) && cfg.command.length > 0;
    const running = processes.has(id);
    const requirements =
      cfg.requirements && typeof cfg.requirements === 'object'
        ? cfg.requirements
        : undefined;
    return {
      id,
      label: cfg.label ?? id,
      disabled,
      running,
      extensions: cfg.extensions ?? [],
      builtin: builtinIds.has(id),
      hasCommand,
      requirements,
      disabledReason: deriveDisabledReason(cfg, { disabled, hasCommand, running }),
      defaultEnabled: cfg.defaultEnabled === true,
    };
  });
}

/** @internal Test-only — in-memory sync state for a project-relative path. */
export function getLspDocumentSyncForTest(relativePath) {
  const fileUri = toFileUri(relativePath);
  const entry = documentSync.get(fileUri);
  if (!entry) return null;
  return { version: entry.version, text: entry.text };
}

/** Stop specific language servers (e.g. after scaffolded tsconfig so tsserver reloads). */
export function shutdownLspServers(serverIds) {
  const ids = new Set(serverIds.map((id) => String(id)));
  for (const id of ids) {
    pendingConnections.delete(id);
    const state = processes.get(id);
    if (state) discardLspState(id, state);
  }
}

export function shutdownAllLsp() {
  pendingConnections.clear();
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
