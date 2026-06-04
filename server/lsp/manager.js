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
import { matchServersForPath } from '../../src/lsp/merge-config.mjs';
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

/** Prefer textEdit / insert-replace range over bare insertText. */
function extractCompletionInsertFields(item) {
  let insertText = String(item.insertText ?? item.label ?? '');
  let textEditRange;
  const te = item.textEdit;
  if (te && typeof te === 'object') {
    if (te.range != null && te.newText != null) {
      insertText = String(te.newText);
      textEditRange = normalizeLspRange(te.range);
    } else if (te.replace != null) {
      insertText = String(te.newText ?? insertText);
      textEditRange = normalizeLspRange(te.replace);
    }
  }
  return { insertText, textEditRange };
}

function normalizeCompletionItems(result) {
  const raw = Array.isArray(result) ? result : (result?.items ?? []);
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label ?? '');
    if (!label) continue;
    const { insertText, textEditRange } = extractCompletionInsertFields(item);
    const entry = {
      label,
      insertText,
      kind: typeof item.kind === 'number' ? item.kind : undefined,
      detail: item.detail != null ? String(item.detail) : undefined,
    };
    if (textEditRange) entry.textEditRange = textEditRange;
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
  };
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
  };

  connection.onNotification('textDocument/publishDiagnostics', (params) => {
    if (params?.uri) {
      state.diagnostics.set(params.uri, params.diagnostics ?? []);
    }
  });

  bindLspProcessLifecycle(serverId, state);

  try {
    connection.listen();
    await connection.sendRequest('initialize', {
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
              resolveSupport: {
                properties: ['documentation', 'detail', 'additionalTextEdits'],
              },
            },
          },
        },
      },
    });
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

async function ensureDocumentSynced(relativePath) {
  const fileUri = toFileUri(relativePath);
  if (!documentSync.has(fileUri)) {
    const fs = await import('node:fs/promises');
    const abs = path.resolve(getWorkspaceRoot(), relativePath);
    const diskText = await fs.readFile(abs, 'utf8').catch(() => '');
    await notifyLspDocument(relativePath, 'open', diskText);
  }
  return fileUri;
}

/** Brief wait for publishDiagnostics after the document is already synced. */
async function awaitPublishedDiagnostics() {
  await new Promise((r) => setTimeout(r, 200));
}

async function withLspMatchers(relativePath, handler) {
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
  const fileUri = await ensureDocumentSynced(relativePath);
  return handler({ merged, matchers, fileUri });
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

  const abs = path.resolve(getWorkspaceRoot(), relativePath);
  const fileUri = toFileUri(relativePath);
  const matchers = matchServersForPath(merged, relativePath);
  if (matchers.length === 0) {
    return `No LSP server configured for ${relativePath}.`;
  }

  const parts = [];
  for (const { id, config } of matchers) {
    try {
      const state = await getConnection(id, config);
      if (!documentSync.has(fileUri)) {
        const fsMod = await import('node:fs/promises');
        const text = await fsMod.readFile(abs, 'utf8').catch(() => '');
        await notifyLspDocument(relativePath, 'open', text);
      }
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
 */
export async function getLspStructuredDiagnostics(relativePath) {
  const ctx = await withLspMatchers(relativePath, async ({ matchers, fileUri }) => ({
    ok: true,
    matchers,
    fileUri,
  }));
  if (!ctx.ok) {
    return { diagnostics: [], error: ctx.error };
  }

  const abs = path.resolve(getWorkspaceRoot(), relativePath);
  const parts = [];
  for (const { id, config } of ctx.matchers) {
    try {
      const state = await getConnection(id, config);
      if (!documentSync.has(ctx.fileUri)) {
        const fsMod = await import('node:fs/promises');
        const text = await fsMod.readFile(abs, 'utf8').catch(() => '');
        await notifyLspDocument(relativePath, 'open', text);
      }
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
