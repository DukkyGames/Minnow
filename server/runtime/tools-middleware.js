/**
 * Connect middleware for POST /api/tools and server-side tool execution.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { COMMAND_TIMEOUT_MS, formatProcessOutput, runProcess } from '../process-runner.js';
import {
  createBackgroundRun,
  executeCommandBlocking,
  listActiveRuns,
  readCommandLogSnapshot,
  stopActiveRunsForChat,
  waitForRunOutput,
} from '../terminal-runner.js';
import { toolRunImpeccable } from '../impeccable/run-impeccable.js';
import { toolLoadImpeccableContext } from '../impeccable/load-impeccable-context.js';
import {
  blockPlanModeWrite,
  resolveModeIdFromToolsBody,
} from '../tools/plan-write-guard.js';
import { assessHostKillCommand } from '../tools/host-kill-guard.js';
import { toolManageCalendar } from '../calendar/tool-handler.js';
import {
  toolDraftReply,
  toolEmailAction,
  toolGenerateReplyVariants,
  toolListMail,
  toolSummarizeInbox,
} from '../email/tool-handler.js';
import {
  toolBrainAppendLog,
  toolBrainIngestSource,
  toolBrainList,
  toolBrainReadPage,
  toolBrainSearch,
  toolBrainWritePage,
} from '../tools/brain-tools.js';
import {
  toolExplainSymbol,
  toolFindSymbol,
  toolReadSymbol,
  toolRepoMap,
  toolWhoCalls,
} from '../tools/code-tools.js';
import { toolSaveMemory } from '../tools/memory-tools.js';
import { toolReadDocument } from '../tools/read-document.js';
import { toolBoardProvisionInfra } from '../workspace/board-infra-provision.js';
import {
  toolFetchWebContent,
  toolRagWebContent,
} from '../tools/fetch-web-content.js';
import {
  formatDdgSearchResults,
  searchDdgStructured,
} from '../tools/web-search-ddg.js';
import { runTavilySearch } from '../tools/web-search-tavily.js';
import { runSearxngSearch } from '../tools/web-search-searxng.js';
import { loadSearchSettings } from '../research/search.js';
import { getFilesystemAccessFromConfig } from '../config/tool-security.js';
import { callMcpTool, isMcpToolName } from '../mcp/registry.js';
import { callPluginTool, isPluginToolName } from '../tools/loader.js';
import {
  getHomeReefModulesDir,
  isAllowedReefModulePath,
  tryResolveReefModulesFindRoot,
  tryResolveReefWidgetsFindRoot,
} from '../reef/widget-paths.js';
import {
  getHomeReefArtifactsDir,
  isAllowedReefArtifactPath,
  tryResolveReefArtifactsFindRoot,
} from '../reef/artifact-paths.js';
import {
  appendArtifactVersionFromSave,
  getArtifactWithCurrentBody,
} from '../reef/artifact-store.js';
import {
  buildAddOnlyDiffLines,
  buildCodeChangePayload,
  buildRemoveOnlyDiffLines,
  codeChangeFromDiff,
  countAppendLineStats,
  countLinesInText,
} from '../tools/line-diff-stats.js';
import { codeChangeForGitCommit } from '../tools/git-change-stats.js';
import {
  captureWorkspaceSnapshot,
  readHeuristicFileSnapshot,
  resolveExecuteCommandCodeChange,
} from '../tools/workspace-change-snapshot.js';
import { runGrepSearch } from '../tools/grep.js';
import { validateAllowedWorkspaceRoot } from '../chats-workspace/paths.js';
import { getAppRoot, getWorkspaceRoot } from '../workspace/root.js';
import { wrapServerToolResult } from '../security/untrusted.js';
import {
  getEffectiveWorkspaceRoot,
  resolveSafePath,
  runWithToolContext,
} from './path-access.js';
import {
  toolStartBackgroundCommand,
  toolStopBackgroundCommand,
  toolStopCommand,
} from '../dev-server/manager.js';
import { resolveChatContext } from '../workspace/chat-cwd.js';
import { appendBoardLogLine } from '../orchestrate/board-log-sink.js';
import { guardCdOutsideWorktree as _guardCdRaw } from '../tools/cwd-guard.js';
import { readConfigJson } from '../config/store.js';

const execFileAsync = promisify(execFile);
const FIND_FILES_MAX = 500;

/** Read the autopilot.guardCdOutsideWorktree toggle from config.json (defaults true). */
async function isGuardCdEnabled() {
  try {
    const meta = await readConfigJson('config.json');
    const autopilot = meta && typeof meta === 'object' ? /** @type {Record<string, unknown>} */ (meta).autopilot : null;
    if (autopilot && typeof autopilot === 'object') {
      const flag = /** @type {Record<string, unknown>} */ (autopilot).guardCdOutsideWorktree;
      if (typeof flag === 'boolean') return flag;
    }
  } catch {
    // ignore — default true
  }
  return true;
}

/** Path relative to workspace root for display in tool output. */
function toRelativePath(absPath) {
  if (isAllowedReefModulePath(absPath)) {
    const rel = path.relative(getHomeReefModulesDir(), absPath).replace(/\\/g, '/');
    return rel ? `@minnow/reef/modules/${rel}` : '@minnow/reef/modules';
  }
  if (isAllowedReefArtifactPath(absPath)) {
    const rel = path.relative(getHomeReefArtifactsDir(), absPath).replace(/\\/g, '/');
    if (!rel) return '@minnow/reef/artifacts';
    const segments = rel.split('/');
    if (segments.length === 1 && segments[0].match(/^v\d+\.md$/)) {
      return `@minnow/reef/artifacts/${path.basename(path.dirname(absPath))}`;
    }
    if (segments[1] === 'manifest.json') {
      return `@minnow/reef/artifacts/${segments[0]}/manifest.json`;
    }
    return rel ? `@minnow/reef/artifacts/${rel}` : '@minnow/reef/artifacts';
  }
  const rel = path.relative(getEffectiveWorkspaceRoot(), absPath);
  return rel === '' ? '.' : rel.replace(/\\/g, '/');
}

/** Run git with arguments in the project root. */
async function runGit(args) {
  try {
    const result = await runProcess('git', args, { cwd: getEffectiveWorkspaceRoot() });
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

/** Read Tavily API key from search.json with tools.json fallback. */
async function readTavilyApiKeyFromConfig() {
  const settings = await loadSearchSettings();
  return settings.tavilyApiKey;
}

/** DuckDuckGo HTML search (no API key); detects bot challenges before parsing. */
async function toolWebSearchDdg(args) {
  const query = args?.query;
  if (!query || typeof query !== 'string') {
    return 'Error: query is required';
  }

  const { results, error } = await searchDdgStructured(query);
  if (error) {
    return error;
  }
  return formatDdgSearchResults(query, results);
}

/** Tavily Search API (requires tavilyApiKey in search.json or tools.json). */
async function toolWebSearchTavily(args) {
  const query = args?.query;
  if (!query || typeof query !== 'string') {
    return 'Error: query is required';
  }

  const apiKey = await readTavilyApiKeyFromConfig();
  if (!apiKey) {
    return 'Error: Tavily API key not configured. Add one in Settings → Tools.';
  }

  return runTavilySearch(query, apiKey);
}

/** SearXNG JSON search (requires searxngUrl in search.json). */
async function toolWebSearchSearxng(args) {
  const query = args?.query;
  if (!query || typeof query !== 'string') {
    return 'Error: query is required';
  }

  const settings = await loadSearchSettings();
  return runSearxngSearch(query, settings.searxngUrl);
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

/** Read UTF-8 file or empty string when missing (for before-write diffs). */
async function readUtf8OrEmpty(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
    if (code === 'ENOENT') return '';
    throw err;
  }
}

/** Attach codeChange when line stats are non-zero. */
function withCodeChange(message, codeChange) {
  if (codeChange && (codeChange.additions > 0 || codeChange.deletions > 0)) {
    return { result: message, codeChange };
  }
  return message;
}

/** Reef artifact id from an absolute artifact body path. */
function artifactIdFromAbsPath(absPath) {
  const root = path.resolve(getHomeReefArtifactsDir());
  const rel = path.relative(root, path.resolve(absPath)).replace(/\\/g, '/');
  const segments = rel.split('/').filter(Boolean);
  return segments[0] ?? null;
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
  const filePath = resolveSafePath(args?.path, { write: true });
  if (args?.content === undefined) {
    return 'Error: content is required';
  }
  const rel = toRelativePath(filePath);
  const nextContent = String(args.content);
  if (isAllowedReefArtifactPath(filePath)) {
    let before = '';
    const artifactId = artifactIdFromAbsPath(filePath);
    if (artifactId) {
      const current = await getArtifactWithCurrentBody(artifactId);
      before = current?.body ?? '';
    }
    const result = await appendArtifactVersionFromSave(filePath, nextContent, 'agent');
    const message = `Saved reef artifact ${result.manifest.id} v${result.version} (${nextContent.length} bytes)`;
    return withCodeChange(message, codeChangeFromDiff(before, nextContent, rel));
  }
  const before = await readUtf8OrEmpty(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, nextContent, 'utf8');
  const message = `Saved ${rel} (${nextContent.length} bytes)`;
  return withCodeChange(message, codeChangeFromDiff(before, nextContent, rel));
}

async function toolAppendFile(args) {
  const filePath = resolveSafePath(args?.path, { write: true });
  if (args?.content === undefined) {
    return 'Error: content is required';
  }
  const rel = toRelativePath(filePath);
  const content = String(args.content);
  const appendStats = countAppendLineStats(content);
  const { lines, truncated } = buildAddOnlyDiffLines(content);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, content, 'utf8');
  const message = `Appended to ${rel}`;
  return withCodeChange(
    message,
    buildCodeChangePayload({
      ...appendStats,
      path: rel,
      source: 'file-tool',
      diffLines: lines,
      diffTruncated: truncated,
    }),
  );
}

async function toolInsertAtLine(args) {
  const filePath = resolveSafePath(args?.path, { write: true });
  const lineNumber = Number(args?.line_number);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    return 'Error: line_number must be a positive integer (1-based)';
  }
  if (args?.content === undefined) {
    return 'Error: content is required';
  }
  const rel = toRelativePath(filePath);
  const content = String(args.content);
  const insertStats = countAppendLineStats(content);
  const { lines: diffLines, truncated } = buildAddOnlyDiffLines(content);
  const existing = await fs.readFile(filePath, 'utf8');
  const lines = existing.split(/\r?\n/);
  const insertLines = content.split(/\r?\n/);
  const index = Math.min(lineNumber - 1, lines.length);
  lines.splice(index, 0, ...insertLines);
  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
  const message = `Inserted ${insertLines.length} line(s) at line ${lineNumber} in ${rel}`;
  return withCodeChange(
    message,
    buildCodeChangePayload({
      ...insertStats,
      path: rel,
      source: 'file-tool',
      diffLines,
      diffTruncated: truncated,
    }),
  );
}

async function toolReplaceTextInFile(args) {
  const filePath = resolveSafePath(args?.path, { write: true });
  const search = args?.search;
  const replace = args?.replace ?? '';
  if (search === undefined) {
    return 'Error: search is required';
  }
  const rel = toRelativePath(filePath);
  const content = await fs.readFile(filePath, 'utf8');
  const parts = content.split(String(search));
  const count = parts.length - 1;
  if (count === 0) {
    return `No occurrences of search text in ${rel}`;
  }
  const after = parts.join(String(replace));
  await fs.writeFile(filePath, after, 'utf8');
  const message = `Replaced ${count} occurrence(s) in ${rel}`;
  return withCodeChange(message, codeChangeFromDiff(content, after, rel));
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

async function toolGrep(args) {
  return runGrepSearch(args, {
    resolveSafePath,
    toRelativePath,
    getWorkspaceRoot: getEffectiveWorkspaceRoot,
  });
}

async function toolMakeDirectory(args) {
  const dirPath = resolveSafePath(args?.path, { write: true });
  await fs.mkdir(dirPath, { recursive: true });
  return `Created directory ${toRelativePath(dirPath)}`;
}

async function toolMoveFile(args) {
  const source = resolveSafePath(args?.source);
  const destination = resolveSafePath(args?.destination, { write: true });
  const destRel = toRelativePath(destination);
  const destBefore = await readUtf8OrEmpty(destination);
  let sourceContent = '';
  try {
    const srcStat = await fs.stat(source);
    if (srcStat.isFile()) {
      sourceContent = await fs.readFile(source, 'utf8');
    }
  } catch {
    /* Non-file or missing source — stats omitted below. */
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.rename(source, destination);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
    if (code === 'EBUSY' || code === 'EPERM') {
      const hint =
        code === 'EBUSY'
          ? 'File is in use — close other apps using it, then try again.'
          : 'Permission denied — check file permissions or close apps using this file.';
      return `Error: ${hint}`;
    }
    throw err;
  }
  const message = `Moved ${toRelativePath(source)} -> ${destRel}`;
  return withCodeChange(message, codeChangeFromDiff(destBefore, sourceContent, destRel));
}

async function toolCopyFile(args) {
  const source = resolveSafePath(args?.source);
  const destination = resolveSafePath(args?.destination, { write: true });
  const stat = await fs.stat(source);
  if (!stat.isFile()) {
    return `Error: source "${args.source}" is not a file (use move for directories)`;
  }
  const destRel = toRelativePath(destination);
  const destBefore = await readUtf8OrEmpty(destination);
  const sourceContent = await fs.readFile(source, 'utf8');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  const message = `Copied ${toRelativePath(source)} -> ${destRel}`;
  return withCodeChange(message, codeChangeFromDiff(destBefore, sourceContent, destRel));
}

async function toolDeletePath(args) {
  const target = resolveSafePath(args?.path, { write: true });
  const rel = toRelativePath(target);
  const stat = await fs.stat(target);
  if (stat.isDirectory()) {
    await fs.rm(target, { recursive: true, force: true });
    return `Deleted ${rel}`;
  }
  const content = await fs.readFile(target, 'utf8');
  const deletions = countLinesInText(content);
  const { lines, truncated } = buildRemoveOnlyDiffLines(content);
  await fs.unlink(target);
  const message = `Deleted ${rel}`;
  if (deletions === 0) return message;
  return withCodeChange(
    message,
    buildCodeChangePayload({
      additions: 0,
      deletions,
      path: rel,
      source: 'file-tool',
      diffLines: lines,
      diffTruncated: truncated,
    }),
  );
}

async function toolFindFiles(args) {
  const pattern = args?.pattern;
  if (!pattern || typeof pattern !== 'string') {
    return 'Error: pattern is required';
  }
  const reefModulesRoot = tryResolveReefModulesFindRoot(pattern, args?.path ?? '.');
  const reefArtifactsRoot = reefModulesRoot
    ? null
    : tryResolveReefArtifactsFindRoot(pattern, args?.path ?? '.');
  const reefWidgetsRoot =
    reefModulesRoot || reefArtifactsRoot
      ? null
      : tryResolveReefWidgetsFindRoot(pattern, args?.path ?? '.');
  const reefRoot = reefModulesRoot ?? reefArtifactsRoot ?? reefWidgetsRoot;
  const root = reefRoot ?? resolveSafePath(args?.path ?? '.');
  const patternNorm = pattern.replace(/\\/g, '/');
  const matcher = globToRegExp(
    reefModulesRoot && patternNorm.includes('reef/modules')
      ? patternNorm.replace(/^.*reef\/modules\//, '')
      : reefArtifactsRoot && patternNorm.includes('reef/artifacts')
        ? patternNorm.replace(/^.*reef\/artifacts\//, '')
        : reefWidgetsRoot && patternNorm.includes('reef/widgets')
          ? patternNorm.replace(/^.*reef\/widgets\//, '')
          : patternNorm,
  );
  const matches = [];
  const displayRoot = reefModulesRoot
    ? '@minnow/reef/modules'
    : reefArtifactsRoot
      ? '@minnow/reef/artifacts'
      : reefWidgetsRoot
        ? '@minnow/reef/widgets'
        : toRelativePath(root);

  function formatMatch(absPath) {
    if (!reefRoot) {
      return toRelativePath(absPath).replace(/\\/g, '/');
    }
    const rel = path.relative(reefRoot, absPath).replace(/\\/g, '/');
    if (reefModulesRoot) {
      return rel ? `@minnow/reef/modules/${rel}` : '@minnow/reef/modules';
    }
    if (reefArtifactsRoot) {
      return rel ? `@minnow/reef/artifacts/${rel}` : '@minnow/reef/artifacts';
    }
    return rel ? `@minnow/reef/widgets/${rel}` : '@minnow/reef/widgets';
  }

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
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (matcher.test(rel) || matcher.test(ent.name)) {
        matches.push(formatMatch(full));
      }
      if (ent.isDirectory()) {
        await walk(full);
      }
    }
  }

  await walk(root);
  if (matches.length === 0) {
    return `No files matching "${pattern}" under ${displayRoot}`;
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
  const result = await runGit(['commit', '-m', message]);
  if (String(result).trimStart().startsWith('Error')) {
    return result;
  }
  const codeChange = await codeChangeForGitCommit(getWorkspaceRoot());
  return withCodeChange(String(result), codeChange);
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

const BLOCK_UNTIL_MS_MAX = 120_000;

function clampBlockUntilMs(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.floor(n), BLOCK_UNTIL_MS_MAX));
}

function resolveCommandCwd(args) {
  const cwdUser =
    typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : '.';
  return resolveSafePath(cwdUser, { write: false });
}

/**
 * Resolve the default working directory for a command: the chat's worktree when available,
 * otherwise the global workspace root. Used when args.cwd is absent.
 * Does NOT route through resolveSafePath so worktree paths are not constrained to global root.
 * @param {string | undefined} chatId
 * @returns {Promise<string>}
 */
async function resolveDefaultCwd(chatId) {
  if (chatId) {
    const { worktreeRoot } = await resolveChatContext(chatId);
    if (worktreeRoot) return worktreeRoot;
  }
  return getEffectiveWorkspaceRoot();
}

/**
 * Wrapper around guardCdOutsideWorktree that also fires a board-log warning.
 * @param {string} command
 * @param {string} worktreeRoot
 * @param {{ chatId?: string; groupId?: string }} meta
 * @returns {{ command: string; redirected: boolean }}
 */
function guardCdOutsideWorktree(command, worktreeRoot, meta) {
  const result = _guardCdRaw(command, worktreeRoot);
  if (result.redirected && meta.groupId) {
    void appendBoardLogLine(meta.groupId, {
      type: 'cwd_redirect',
      chatId: meta.chatId,
      from: /** @type {any} */ (result).originalTarget ?? '(unknown)',
      to: worktreeRoot,
      reason: 'worktree_isolation',
      ts: Date.now(),
    });
  }
  return result;
}

async function resolveBoardSpawnEnv(args, cwd, chatId) {
  try {
    const { resolveBoardTaskSpawnEnvForCommand } = await import(
      '../workspace/board-task-ports.js'
    );
    return await resolveBoardTaskSpawnEnvForCommand({ chatId, cwd });
  } catch {
    return undefined;
  }
}

async function toolExecuteCommand(args) {
  if (args?.stop === true) {
    return toolStopCommand(args);
  }

  if (typeof args?.command === 'string') {
    const hostKill = assessHostKillCommand(args.command);
    if (hostKill) return hostKill;
  }

  if (args?.background === true) {
    const command = typeof args?.command === 'string' ? args.command.trim() : '';
    if (!command) return 'Error: command is required';

    const chatId = typeof args?.chatId === 'string' ? args.chatId : undefined;

    let cwd;
    if (typeof args?.cwd === 'string' && args.cwd.trim()) {
      try {
        cwd = resolveCommandCwd(args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    } else {
      cwd = await resolveDefaultCwd(chatId);
    }
    const toolCallId =
      typeof args?.toolCallId === 'string' ? args.toolCallId : undefined;
    const spawnEnv = await resolveBoardSpawnEnv(args, cwd, chatId);

    try {
      const started = await createBackgroundRun({
        command,
        cwd,
        shell: process.platform === 'win32',
        source: 'agent',
        chatId,
        toolCallId,
        logSubdir: 'terminal',
        ...(spawnEnv ? { env: spawnEnv } : {}),
      });
      const blockUntilMs = clampBlockUntilMs(args?.block_until_ms);
      const output =
        blockUntilMs > 0
          ? await waitForRunOutput(started.runId, blockUntilMs)
          : '';
      return JSON.stringify(
        {
          ok: true,
          background: true,
          runId: started.runId,
          pid: started.pid,
          logPath: started.logPath,
          startedAt: started.startedAt,
          output,
        },
        null,
        2,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }

  const rawCommand = args?.command;
  if (!rawCommand || typeof rawCommand !== 'string') {
    return 'Error: command is required';
  }

  const chatId = typeof args?.chatId === 'string' ? args.chatId : undefined;
  const toolCallId = typeof args?.toolCallId === 'string' ? args.toolCallId : undefined;

  let command = rawCommand;
  let cwd;
  if (typeof args?.cwd === 'string' && args.cwd.trim()) {
    try {
      cwd = resolveCommandCwd(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  } else {
    const { worktreeRoot, groupId } = await resolveChatContext(chatId ?? '');
    cwd = worktreeRoot ?? getEffectiveWorkspaceRoot();
    if (worktreeRoot && await isGuardCdEnabled()) {
      const guarded = guardCdOutsideWorktree(rawCommand, worktreeRoot, { chatId, groupId });
      if (guarded.redirected) command = guarded.command;
    }
  }
  const spawnEnv = await resolveBoardSpawnEnv(args, cwd, chatId);

  const workspaceRoot = getEffectiveWorkspaceRoot();
  const beforeSnapshot = await captureWorkspaceSnapshot(workspaceRoot);
  const beforeFileContents = new Map();
  const heuristicRel = String(command).match(
    /\bsed\s+(?:-[^\s]+\s+)*['"]?([^'"\s|>]+)['"]?/i,
  )?.[1];
  if (heuristicRel) {
    beforeFileContents.set(
      heuristicRel,
      await readHeuristicFileSnapshot(workspaceRoot, heuristicRel),
    );
  }

  try {
    const output = await executeCommandBlocking({
      command,
      cwd,
      shell: process.platform === 'win32',
      chatId,
      toolCallId,
      timeoutMs: typeof args?.timeout_ms === 'number' ? args.timeout_ms : undefined,
      ...(spawnEnv ? { env: spawnEnv } : {}),
    });
    if (String(output).trimStart().startsWith('Error')) {
      return output;
    }
    const codeChange = await resolveExecuteCommandCodeChange({
      cwd: workspaceRoot,
      command,
      beforeSnapshot,
      beforeFileContents,
    });
    return withCodeChange(String(output), codeChange);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

async function toolReadCommandLog(args) {
  const runId = typeof args?.run_id === 'string' ? args.run_id.trim() : '';
  if (!runId) return 'Error: run_id is required';

  const maxBytes =
    typeof args?.max_bytes === 'number' && Number.isFinite(args.max_bytes)
      ? Math.max(1024, Math.min(Math.floor(args.max_bytes), 512 * 1024))
      : 64 * 1024;

  try {
    const snapshot = await readCommandLogSnapshot(runId, maxBytes);
    return JSON.stringify(snapshot, null, 2);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

async function toolListRunningCommands(args) {
  const chatId =
    typeof args?.chat_id === 'string' && args.chat_id.trim()
      ? args.chat_id.trim()
      : undefined;
  const runs = listActiveRuns({ source: 'agent', ...(chatId ? { chatId } : {}) });
  return JSON.stringify({ ok: true, runs }, null, 2);
}

async function toolRunJavascript(args) {
  const code = args?.code;
  if (!code || typeof code !== 'string') {
    return 'Error: code is required';
  }

  try {
    const result = await runProcess('node', ['-e', code], {
      cwd: getEffectiveWorkspaceRoot(),
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
        cwd: getEffectiveWorkspaceRoot(),
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

/** Map tool name -> handler (serverRequired tools + web search backends, send_notification). */
const SERVER_TOOL_HANDLERS = {
  web_search_ddg: toolWebSearchDdg,
  web_search_tavily: toolWebSearchTavily,
  web_search_searxng: toolWebSearchSearxng,
  fetch_web_content: toolFetchWebContent,
  rag_web_content: toolRagWebContent,
  list_directory: toolListDirectory,
  read_file: toolReadFile,
  read_file_range: toolReadFileRange,
  save_file: toolSaveFile,
  append_file: toolAppendFile,
  insert_at_line: toolInsertAtLine,
  replace_text_in_file: toolReplaceTextInFile,
  search_in_file: toolSearchInFile,
  grep: toolGrep,
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
  read_command_log: toolReadCommandLog,
  list_running_commands: toolListRunningCommands,
  stop_command: toolStopCommand,
  start_background_command: toolStartBackgroundCommand,
  stop_background_command: toolStopBackgroundCommand,
  run_javascript: toolRunJavascript,
  run_python: toolRunPython,
  send_notification: toolSendNotification,
  read_document: toolReadDocument,
  run_impeccable: (args) =>
    toolRunImpeccable(args, getAppRoot(), getEffectiveWorkspaceRoot()),
  load_impeccable_context: () =>
    toolLoadImpeccableContext(getAppRoot(), getEffectiveWorkspaceRoot()),
  get_lsp_diagnostics: async (args) => {
    const { getLspDiagnostics } = await import('../lsp/manager.js');
    return getLspDiagnostics(String(args?.path ?? ''));
  },
  list_lsp_servers: async () => {
    const { listLspServers } = await import('../lsp/manager.js');
    return JSON.stringify(await listLspServers(), null, 2);
  },
  brain_search: toolBrainSearch,
  brain_read_page: toolBrainReadPage,
  brain_list: toolBrainList,
  brain_write_page: toolBrainWritePage,
  brain_append_log: toolBrainAppendLog,
  brain_ingest_source: toolBrainIngestSource,
  save_memory: toolSaveMemory,
  board_provision_infra: toolBoardProvisionInfra,
  repo_map: toolRepoMap,
  find_symbol: toolFindSymbol,
  who_calls: toolWhoCalls,
  read_symbol: toolReadSymbol,
  explain_symbol: toolExplainSymbol,
  manage_calendar: toolManageCalendar,
  list_mail: toolListMail,
  draft_reply: toolDraftReply,
  summarize_inbox: toolSummarizeInbox,
  generate_reply_variants: toolGenerateReplyVariants,
  email_action: toolEmailAction,
};

/**
 * Execute a server-side tool by name.
 * All tools return strings; errors are returned as string messages, not thrown to HTTP layer.
 */
/**
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @param {{ workspaceRoot?: string }} [options]
 */
export async function executeServerTool(name, args, options = {}) {
  const fsAccess = await getFilesystemAccessFromConfig();
  const allowOutsideWorkspace = fsAccess === 'full';
  return runWithToolContext(async () => {
    try {
      if (isPluginToolName(name)) {
        const result = await callPluginTool(name, args ?? {});
        return { result: wrapServerToolResult(name, args ?? {}, String(result)) };
      }
      if (isMcpToolName(name)) {
        const result = await callMcpTool(name, args ?? {});
        return { result: wrapServerToolResult(name, args ?? {}, String(result)) };
      }
      const handler = SERVER_TOOL_HANDLERS[name];
      if (!handler) {
        return { result: `Not implemented: ${name}` };
      }
      const out = await handler(args ?? {});
      if (out && typeof out === 'object' && 'result' in out) {
        return {
          ...out,
          result: wrapServerToolResult(name, args ?? {}, String(out.result)),
        };
      }
      return { result: wrapServerToolResult(name, args ?? {}, String(out)) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: `Error: ${message}` };
    }
  }, {
    allowOutsideWorkspace,
    workspaceRoot: options.workspaceRoot,
  });
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
export function createToolsMiddleware() {
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

    if (url === '/api/tools/code-change-for-commit' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      try {
        const body = await readJsonBody(req);
        const sha = typeof body?.sha === 'string' ? body.sha.trim() : '';
        if (!sha) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Missing or invalid "sha"' }));
          return;
        }
        const codeChange = await codeChangeForGitCommit(getWorkspaceRoot(), sha);
        res.statusCode = 200;
        res.end(JSON.stringify({ codeChange: codeChange ?? null }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.statusCode = 400;
        res.end(JSON.stringify({ error: message }));
      }
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
        const modeId = resolveModeIdFromToolsBody(body);
        const planWriteBlock = blockPlanModeWrite(modeId, name, args);
        if (planWriteBlock) {
          res.statusCode = 200;
          res.end(JSON.stringify({ result: planWriteBlock }));
          return;
        }

        let workspaceRoot;
        if (body?.workspaceRoot != null) {
          if (typeof body.workspaceRoot !== 'string' || !body.workspaceRoot.trim()) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid workspaceRoot' }));
            return;
          }
          try {
            workspaceRoot = await validateAllowedWorkspaceRoot(body.workspaceRoot);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            res.statusCode = 400;
            res.end(JSON.stringify({ error: message }));
            return;
          }
        }

        const out = await executeServerTool(name, args, { workspaceRoot });
        res.statusCode = 200;
        const payload = { result: String(out.result ?? '') };
        if (Array.isArray(out.attachments) && out.attachments.length > 0) {
          payload.attachments = out.attachments;
        }
        if (out.codeChange && typeof out.codeChange === 'object') {
          payload.codeChange = out.codeChange;
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