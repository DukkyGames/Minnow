/**
 * Minnow dev server: Vite + /api/tools middleware for LM Studio tool execution.
 * SA-4: full executeServerTool handlers (files, git, code, web, notifications).
 * SA-14: read_document (PDF text extraction via optional pdf-parse).
 */

import { createServer } from 'vite';
import { spawn, execFile } from 'node:child_process';
import { COMMAND_TIMEOUT_MS, formatProcessOutput, runProcess } from './server/process-runner.js';
import { createTerminalMiddleware } from './server/terminal/middleware.js';
import { executeCommandBlocking } from './server/terminal-runner.js';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createConfigMiddleware } from './server/config/middleware.js';
import { createPromptConfigsMiddleware } from './server/prompt-configs/middleware.js';
import { ensureMinnowLayout, getMinnowHome } from './server/config/home.js';
import { createProviderMiddleware } from './server/providers/routes.js';
import { createWorkAgentsMiddleware } from './server/work-agents/routes.js';
import { createSkillsMiddleware } from './server/skills/middleware.js';
import { ensureProviderRegistry } from './server/providers/store.js';
import { BROWSER_TOOL_HANDLERS } from './server/cdp/browser-tools.js';
import { createBrowserScreenshotMiddleware } from './server/browser-screenshot-middleware.js';
import { toolRunImpeccable } from './server/impeccable/run-impeccable.js';
import { createMemoryMiddleware } from './server/memory/middleware.js';
import { initMemoryApi } from './server/memory/routes.js';
import { createLspMiddleware, initLspConfig } from './server/lsp/middleware.js';
import { createMcpMiddleware, initMcpApi } from './server/mcp/middleware.js';
import { callMcpTool, isMcpToolName } from './server/mcp/registry.js';
import { getAppRoot, getWorkspaceRoot, initWorkspaceRoot } from './server/workspace/root.js';
import { createWorkspaceMiddleware } from './server/workspace/middleware.js';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT) || 5173;
const APP_ROOT = getAppRoot();
const ALLOW_ALL_PATHS = process.env.TOOLS_ALLOW_ALL_PATHS === '1';
const FIND_FILES_MAX = 500;
const DDG_MAX_SNIPPETS = 8;
/** Max decoded PDF size for read_document (aligns with attachment limit). */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Normalize slashes for consistent prefix checks on Windows. */
function normalizePath(p) {
  return path.normalize(p).replace(/\\/g, '/');
}

/**
 * Resolve a user-supplied path under the workspace root unless TOOLS_ALLOW_ALL_PATHS=1.
 * Returns absolute path string, or throws with a message suitable for tool results.
 */
function resolveSafePath(userPath) {
  if (!userPath || typeof userPath !== 'string') {
    throw new Error('Path is required');
  }

  const workspaceRoot = getWorkspaceRoot();
  const resolved = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(workspaceRoot, userPath);

  if (ALLOW_ALL_PATHS) {
    return resolved;
  }

  const rootNorm = normalizePath(workspaceRoot);
  const resolvedNorm = normalizePath(resolved);

  if (resolvedNorm === rootNorm || resolvedNorm.startsWith(`${rootNorm}/`)) {
    return resolved;
  }

  throw new Error(
    `Path "${userPath}" resolves outside the workspace directory. Set TOOLS_ALLOW_ALL_PATHS=1 to allow.`,
  );
}

/** Path relative to workspace root for display in tool output. */
function toRelativePath(absPath) {
  const rel = path.relative(getWorkspaceRoot(), absPath);
  return rel === '' ? '.' : rel.replace(/\\/g, '/');
}

/** Strip HTML tags and decode common entities for search snippets. */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Run git with arguments in the project root. */
async function runGit(args) {
  try {
    const result = await runProcess('git', args, { cwd: getWorkspaceRoot() });
    return formatProcessOutput(`git ${args.join(' ')}`, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error running git: ${message}`;
  }
}

/** Convert a simple glob pattern to a RegExp (supports * and **). */
function globToRegExp(globPattern) {
  let re = '^';
  for (let i = 0; i < globPattern.length; i += 1) {
    const ch = globPattern[i];
    if (ch === '*' && globPattern[i + 1] === '*') {
      re += '.*';
      i += 1;
      if (globPattern[i + 1] === '/') {
        i += 1;
      }
    } else if (ch === '*') {
      re += '[^/\\\\]*';
    } else if (ch === '?') {
      re += '[^/\\\\]';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re, 'i');
}

// --- Web tools ---

/** DuckDuckGo HTML search (no API key); parses result titles and snippets. */
async function toolWebSearchDdg(args) {
  const query = args?.query;
  if (!query || typeof query !== 'string') {
    return 'Error: query is required';
  }

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
  });

  if (!response.ok) {
    return `Error: DuckDuckGo returned HTTP ${response.status}`;
  }

  const html = await response.text();
  const blocks = html.split(/class="result\s/);
  const results = [];

  for (let i = 1; i < blocks.length && results.length < DDG_MAX_SNIPPETS; i += 1) {
    const block = blocks[i];
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) {
      continue;
    }
    const href = titleMatch[1];
    const title = stripHtml(titleMatch[2]);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
    results.push(`${results.length + 1}. ${title}\n   ${href}\n   ${snippet}`);
  }

  if (results.length === 0) {
    return `No DuckDuckGo results found for: ${query}`;
  }

  return `DuckDuckGo results for "${query}":\n\n${results.join('\n\n')}`;
}

// --- File tools ---

async function toolListDirectory(args) {
  const dirPath = resolveSafePath(args?.path ?? '.');
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const lines = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ent) => `${ent.isDirectory() ? '[dir]' : '[file]'} ${ent.name}`);
  return lines.length ? lines.join('\n') : '(empty directory)';
}

async function toolReadFile(args) {
  const filePath = resolveSafePath(args?.path);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    return `Error: "${args.path}" is not a file`;
  }
  return await fs.readFile(filePath, 'utf8');
}

async function toolReadFileRange(args) {
  const filePath = resolveSafePath(args?.path);
  const startLine = Number(args?.start_line);
  const endLine = Number(args?.end_line);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    return 'Error: start_line and end_line must be valid integers (1-based, start <= end)';
  }
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const slice = lines.slice(startLine - 1, endLine);
  return slice
    .map((line, idx) => `${startLine + idx}: ${line}`)
    .join('\n');
}

async function toolSaveFile(args) {
  const filePath = resolveSafePath(args?.path);
  if (args?.content === undefined) {
    return 'Error: content is required';
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(args.content), 'utf8');
  return `Saved ${toRelativePath(filePath)} (${String(args.content).length} bytes)`;
}

async function toolAppendFile(args) {
  const filePath = resolveSafePath(args?.path);
  if (args?.content === undefined) {
    return 'Error: content is required';
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, String(args.content), 'utf8');
  return `Appended to ${toRelativePath(filePath)}`;
}

async function toolInsertAtLine(args) {
  const filePath = resolveSafePath(args?.path);
  const lineNumber = Number(args?.line_number);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    return 'Error: line_number must be a positive integer (1-based)';
  }
  if (args?.content === undefined) {
    return 'Error: content is required';
  }
  const existing = await fs.readFile(filePath, 'utf8');
  const lines = existing.split(/\r?\n/);
  const insertLines = String(args.content).split(/\r?\n/);
  const index = Math.min(lineNumber - 1, lines.length);
  lines.splice(index, 0, ...insertLines);
  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
  return `Inserted ${insertLines.length} line(s) at line ${lineNumber} in ${toRelativePath(filePath)}`;
}

async function toolReplaceTextInFile(args) {
  const filePath = resolveSafePath(args?.path);
  const search = args?.search;
  const replace = args?.replace ?? '';
  if (search === undefined) {
    return 'Error: search is required';
  }
  const content = await fs.readFile(filePath, 'utf8');
  const parts = content.split(String(search));
  const count = parts.length - 1;
  if (count === 0) {
    return `No occurrences of search text in ${toRelativePath(filePath)}`;
  }
  await fs.writeFile(filePath, parts.join(String(replace)), 'utf8');
  return `Replaced ${count} occurrence(s) in ${toRelativePath(filePath)}`;
}

async function toolSearchInFile(args) {
  const filePath = resolveSafePath(args?.path);
  const pattern = args?.pattern;
  if (!pattern || typeof pattern !== 'string') {
    return 'Error: pattern is required';
  }
  let regex;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: invalid regex: ${message}`;
  }
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const matches = [];
  lines.forEach((line, idx) => {
    if (line.match(regex)) {
      matches.push(`${idx + 1}: ${line}`);
    }
  });
  return matches.length ? matches.join('\n') : `No matches in ${toRelativePath(filePath)}`;
}

async function toolMakeDirectory(args) {
  const dirPath = resolveSafePath(args?.path);
  await fs.mkdir(dirPath, { recursive: true });
  return `Created directory ${toRelativePath(dirPath)}`;
}

async function toolMoveFile(args) {
  const source = resolveSafePath(args?.source);
  const destination = resolveSafePath(args?.destination);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(source, destination);
  return `Moved ${toRelativePath(source)} -> ${toRelativePath(destination)}`;
}

async function toolCopyFile(args) {
  const source = resolveSafePath(args?.source);
  const destination = resolveSafePath(args?.destination);
  const stat = await fs.stat(source);
  if (!stat.isFile()) {
    return `Error: source "${args.source}" is not a file (use move for directories)`;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  return `Copied ${toRelativePath(source)} -> ${toRelativePath(destination)}`;
}

async function toolDeletePath(args) {
  const target = resolveSafePath(args?.path);
  const stat = await fs.stat(target);
  if (stat.isDirectory()) {
    await fs.rm(target, { recursive: true, force: true });
  } else {
    await fs.unlink(target);
  }
  return `Deleted ${toRelativePath(target)}`;
}

async function toolFindFiles(args) {
  const pattern = args?.pattern;
  if (!pattern || typeof pattern !== 'string') {
    return 'Error: pattern is required';
  }
  const root = resolveSafePath(args?.path ?? '.');
  const matcher = globToRegExp(pattern.replace(/\\/g, '/'));
  const matches = [];

  async function walk(currentDir) {
    if (matches.length >= FIND_FILES_MAX) {
      return;
    }
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const ent of entries) {
      if (matches.length >= FIND_FILES_MAX) {
        break;
      }
      const full = path.join(currentDir, ent.name);
      const rel = toRelativePath(full).replace(/\\/g, '/');
      if (matcher.test(rel) || matcher.test(ent.name)) {
        matches.push(rel);
      }
      if (ent.isDirectory()) {
        await walk(full);
      }
    }
  }

  await walk(root);
  if (matches.length === 0) {
    return `No files matching "${pattern}" under ${toRelativePath(root)}`;
  }
  const suffix =
    matches.length >= FIND_FILES_MAX ? `\n(truncated at ${FIND_FILES_MAX} results)` : '';
  return `${matches.join('\n')}${suffix}`;
}

async function toolGetFileMetadata(args) {
  const target = resolveSafePath(args?.path);
  const stat = await fs.stat(target);
  return [
    `path: ${toRelativePath(target)}`,
    `type: ${stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'}`,
    `size: ${stat.size} bytes`,
    `modified: ${stat.mtime.toISOString()}`,
    `created: ${stat.birthtime.toISOString()}`,
  ].join('\n');
}

// --- Git tools ---

async function toolGitStatus() {
  return runGit(['status', '--porcelain', '-b']);
}

async function toolGitDiff(args) {
  const gitArgs = ['diff'];
  if (args?.staged) {
    gitArgs.push('--cached');
  }
  if (args?.path) {
    gitArgs.push('--', args.path);
  }
  return runGit(gitArgs);
}

async function toolGitLog(args) {
  const count = Number(args?.count) || 10;
  return runGit(['log', `--oneline`, `-n`, String(Math.max(1, Math.min(count, 100)))]);
}

async function toolGitAdd(args) {
  const paths = args?.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    return 'Error: paths array is required';
  }
  return runGit(['add', ...paths.map(String)]);
}

async function toolGitCommit(args) {
  const message = args?.message;
  if (!message || typeof message !== 'string') {
    return 'Error: message is required';
  }
  return runGit(['commit', '-m', message]);
}

async function toolGitCheckout(args) {
  const branch = args?.branch;
  if (!branch || typeof branch !== 'string') {
    return 'Error: branch is required';
  }
  const gitArgs = args?.create ? ['checkout', '-b', branch] : ['checkout', branch];
  return runGit(gitArgs);
}

// --- Code execution tools ---

async function toolExecuteCommand(args) {
  const command = args?.command;
  if (!command || typeof command !== 'string') {
    return 'Error: command is required';
  }

  try {
    return await executeCommandBlocking({
      command,
      cwd: getWorkspaceRoot(),
      shell: process.platform === 'win32',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

async function toolRunJavascript(args) {
  const code = args?.code;
  if (!code || typeof code !== 'string') {
    return 'Error: code is required';
  }

  try {
    const result = await runProcess('node', ['-e', code], {
      cwd: getWorkspaceRoot(),
      timeout: COMMAND_TIMEOUT_MS,
    });
    return formatProcessOutput('node -e', result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

async function toolRunPython(args) {
  const code = args?.code;
  if (!code || typeof code !== 'string') {
    return 'Error: code is required';
  }

  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  let lastError = '';

  for (const bin of candidates) {
    try {
      const result = await runProcess(bin, ['-c', code], {
        cwd: getWorkspaceRoot(),
        timeout: COMMAND_TIMEOUT_MS,
      });
      return formatProcessOutput(`${bin} -c`, result);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return `Error: could not run Python (${lastError})`;
}

// --- Utility tools ---

/** Desktop notification via OS-native commands. */
async function toolSendNotification(args) {
  const title = String(args?.title ?? 'Minnow');
  const message = String(args?.message ?? args?.body ?? '');
  if (!message) {
    return 'Error: message is required';
  }

  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
      await execFileAsync('osascript', ['-e', script]);
      return `Notification sent: ${title}`;
    }

    if (platform === 'linux') {
      await execFileAsync('notify-send', [title, message]);
      return `Notification sent: ${title}`;
    }

    if (platform === 'win32') {
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms',
        `[System.Windows.Forms.MessageBox]::Show(${JSON.stringify(message)}, ${JSON.stringify(title)})`,
      ].join('; ');
      await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { windowsHide: true },
      );
      return `Notification shown: ${title}`;
    }

    return `Error: notifications not supported on ${platform}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error sending notification: ${msg}`;
  }
}

/**
 * Extract plain text from a PDF sent as base64 (attachment pipeline).
 * Uses optional pdf-parse when installed; otherwise returns an install hint.
 */
async function toolReadDocument(args) {
  const contentB64 = args?.content;
  if (!contentB64 || typeof contentB64 !== 'string') {
    return 'Error: content (base64 file bytes) is required';
  }

  const filename =
    typeof args?.filename === 'string' && args.filename.trim()
      ? args.filename.trim()
      : 'document.pdf';

  let buffer;
  try {
    buffer = Buffer.from(contentB64, 'base64');
  } catch {
    return 'Error: content is not valid base64';
  }

  if (buffer.length === 0) {
    return 'Error: empty document';
  }

  if (buffer.length > MAX_DOCUMENT_BYTES) {
    return `Error: document exceeds ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB limit`;
  }

  const looksLikePdf =
    filename.toLowerCase().endsWith('.pdf') ||
    buffer.subarray(0, 5).toString('ascii') === '%PDF-';

  if (!looksLikePdf) {
    return `Error: read_document only supports PDF files (got "${filename}")`;
  }

  let pdfParse;
  try {
    const mod = await import('pdf-parse');
    pdfParse = mod.default ?? mod;
  } catch {
    return (
      'Error: PDF text extraction requires the optional "pdf-parse" package. ' +
      'Install with: npm install (optionalDependencies) or npm install pdf-parse'
    );
  }

  try {
    const parsed = await pdfParse(buffer);
    const text = String(parsed?.text ?? '').trim();
    const pages = parsed?.numpages ?? '?';

    if (!text) {
      return `PDF "${filename}" parsed but contained no extractable text (${pages} page(s)).`;
    }

    return `--- ${filename} (${pages} page(s)) ---\n${text}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: failed to parse PDF "${filename}": ${message}`;
  }
}

/** Map tool name -> handler (serverRequired tools + web_search_ddg, send_notification). */
const SERVER_TOOL_HANDLERS = {
  web_search_ddg: toolWebSearchDdg,
  list_directory: toolListDirectory,
  read_file: toolReadFile,
  read_file_range: toolReadFileRange,
  save_file: toolSaveFile,
  append_file: toolAppendFile,
  insert_at_line: toolInsertAtLine,
  replace_text_in_file: toolReplaceTextInFile,
  search_in_file: toolSearchInFile,
  make_directory: toolMakeDirectory,
  move_file: toolMoveFile,
  copy_file: toolCopyFile,
  delete_path: toolDeletePath,
  find_files: toolFindFiles,
  get_file_metadata: toolGetFileMetadata,
  git_status: toolGitStatus,
  git_diff: toolGitDiff,
  git_log: toolGitLog,
  git_add: toolGitAdd,
  git_commit: toolGitCommit,
  git_checkout: toolGitCheckout,
  execute_command: toolExecuteCommand,
  run_javascript: toolRunJavascript,
  run_python: toolRunPython,
  send_notification: toolSendNotification,
  read_document: toolReadDocument,
  run_impeccable: (args) => toolRunImpeccable(args, getWorkspaceRoot()),
  get_lsp_diagnostics: async (args) => {
    const { getLspDiagnostics } = await import('./server/lsp/manager.js');
    return getLspDiagnostics(String(args?.path ?? ''));
  },
  list_lsp_servers: async () => {
    const { listLspServers } = await import('./server/lsp/manager.js');
    return JSON.stringify(await listLspServers(), null, 2);
  },
  ...BROWSER_TOOL_HANDLERS,
};

/**
 * Execute a server-side tool by name.
 * All tools return strings; errors are returned as string messages, not thrown to HTTP layer.
 */
async function executeServerTool(name, args) {
  try {
    if (isMcpToolName(name)) {
      const result = await callMcpTool(name, args ?? {});
      return { result: String(result) };
    }
    const handler = SERVER_TOOL_HANDLERS[name];
    if (!handler) {
      return { result: `Not implemented: ${name}` };
    }
    const out = await handler(args ?? {});
    if (out && typeof out === 'object' && 'result' in out) {
      return out;
    }
    return { result: String(out) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: `Error: ${message}` };
  }
}

/** CORS headers for local Vite dev (browser tools calling same origin or localhost). */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/** Read JSON body from POST /api/tools. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Connect middleware: handles /api/tools before Vite serves the SPA.
 */
function createToolsMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';

    if (!url.startsWith('/api/tools')) {
      next();
      return;
    }

    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (url === '/api/tools/ping' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url === '/api/tools' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      try {
        const body = await readJsonBody(req);
        const name = body?.name;
        const args = body?.args ?? {};
        if (!name || typeof name !== 'string') {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Missing or invalid "name"' }));
          return;
        }
        const out = await executeServerTool(name, args);
        res.statusCode = 200;
        const payload = { result: String(out.result ?? '') };
        if (Array.isArray(out.attachments) && out.attachments.length > 0) {
          payload.attachments = out.attachments;
        }
        res.end(JSON.stringify(payload));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.statusCode = 400;
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}

/** Open default browser for the dev URL (platform-specific). */
function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;

  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function main() {
  const vite = await createServer({
    configFile: path.join(APP_ROOT, 'vite.config.ts'),
    server: {
      port: PORT,
      strictPort: false,
    },
    plugins: [
      {
        name: 'minnow-api',
        configureServer(server) {
          server.middlewares.use(createConfigMiddleware());
          server.middlewares.use(createWorkspaceMiddleware());
          server.middlewares.use(createMemoryMiddleware());
          server.middlewares.use(createLspMiddleware(() => getWorkspaceRoot()));
          server.middlewares.use(createMcpMiddleware());
          server.middlewares.use(createPromptConfigsMiddleware());
          server.middlewares.use(createProviderMiddleware());
          server.middlewares.use(createWorkAgentsMiddleware());
          server.middlewares.use(createBrowserScreenshotMiddleware());
          server.middlewares.use(createToolsMiddleware());
          server.middlewares.use(createSkillsMiddleware());
          server.middlewares.use(createTerminalMiddleware(() => getWorkspaceRoot()));
        },
      },
    ],
  });

  await ensureMinnowLayout();
  const workspacePath = await initWorkspaceRoot();
  console.log(`Workspace: ${workspacePath}`);
  await ensureProviderRegistry();
  await initMemoryApi();
  await initLspConfig();
  await initMcpApi();
  const homePath = getMinnowHome();
  console.log(`Minnow data: ${homePath}`);

  await vite.listen();
  const urls = vite.resolvedUrls?.local ?? [`http://localhost:${PORT}/`];
  const localUrl = urls[0];
  console.log(`Minnow dev server: ${localUrl}`);
  console.log(`Config API: ${localUrl.replace(/\/$/, '')}/api/config/ping`);
  console.log(`Providers API: ${localUrl.replace(/\/$/, '')}/api/providers`);
  console.log(`Work agents API: ${localUrl.replace(/\/$/, '')}/api/work-agents`);
  console.log(`Tools API: ${localUrl.replace(/\/$/, '')}/api/tools/ping`);
  console.log(`Memory API: ${localUrl.replace(/\/$/, '')}/api/memory/ping`);
  console.log(`LSP API: ${localUrl.replace(/\/$/, '')}/api/lsp/status`);
  console.log(`MCP API: ${localUrl.replace(/\/$/, '')}/api/mcp/ping`);
  console.log(`Skills API: ${localUrl.replace(/\/$/, '')}/api/skills`);
  console.log(`Terminal API: ${localUrl.replace(/\/$/, '')}/api/terminal/run`);
  openBrowser(localUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
