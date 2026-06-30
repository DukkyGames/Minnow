/**
 * Validate session, tool, and system-prompt payloads before writing to disk.
 */

import { ALL_TOOL_IDS, ARCHIVE_RECALL_TOOL_IDS, BRAIN_DESTRUCTIVE_TOOL_IDS, BRAIN_FULL_PERMISSION_TOOL_IDS, BRAIN_FULL_PERMISSION_TOOL_ID_SET } from './tool-ids.js';
import { normalizeOrchestratePlanPath } from './orchestrate-plan-path.js';
import { normalizeSamplerPreset } from '../agents/sampler.js';
import {
  normalizeThinkingGlobalDefault,
  normalizeThinkingTriState,
} from '../agents/thinking.js';
import {
  clampGenerationIdleTimeoutMs,
  clampGenerationMaxDurationMs,
  DEFAULT_GENERATION_IDLE_TIMEOUT_MS,
  DEFAULT_GENERATION_MAX_DURATION_MS,
} from '../generations/timeouts.js';

const DEFAULT_CHAT_MAX_TOOL_TURNS = 100;
const MAX_CHAT_MAX_TOOL_TURNS = 500;
const DEFAULT_SUB_AGENT_MAX_TOOL_TURNS = 100;

const PLACEHOLDER_CHAT_NAME = 'New chat';
const MAX_CHATS = 50;
const SESSION_SCHEMA_VERSION = 5;
const MAX_GOAL_CONDITION_CHARS = 4000;

/** Normalize workspace paths for stable keys (mirror src/lib/normalize-workspace-path.ts). */
function normalizeWorkspacePath(fsPath) {
  if (typeof fsPath !== 'string') return '';
  let p = fsPath.trim().replace(/\\/g, '/');
  p = p.replace(/\/+/g, '/');
  if (/^[a-zA-Z]:\//.test(p)) {
    p = p.charAt(0).toUpperCase() + p.slice(1);
  }
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

function ensureLastActiveMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string' && typeof value === 'string' && value.trim()) {
      out[normalizeWorkspacePath(key)] = value.trim();
    }
  }
  return out;
}

/** Valid operating mode ids (mirror src/chat/modes/types.ts). */
const MODE_IDS = ['general', 'build', 'plan', 'super-plan', 'orchestrate', 'reef', 'debug'];
const DEFAULT_MODE_ID = 'build';

/** Normalize persisted or unknown mode ids. */
function normalizeModeId(value) {
  if (typeof value === 'string' && MODE_IDS.includes(value)) return value;
  return DEFAULT_MODE_ID;
}

/** Default expert picker when missing on older chats. */
function defaultExpertSelection() {
  return { mode: 'auto', expertId: null };
}

/** Coerce expert picker shape (mirror src/state/sessions.ts). */
function ensureExpertSelection(raw) {
  if (!raw || typeof raw !== 'object') return defaultExpertSelection();
  const row = /** @type {Record<string, unknown>} */ (raw);
  const mode = row.mode === 'manual' ? 'manual' : 'auto';
  const expertId =
    mode === 'manual' && typeof row.expertId === 'string' && row.expertId.trim()
      ? row.expertId.trim()
      : null;
  return { mode, expertId };
}

function newChatId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

const BOARD_TASK_STATUSES = new Set([
  'planned',
  'in_progress',
  'testing',
  'merging',
  'complete',
  'failed',
  'blocked',
  'quarantined',
]);
const BOARD_CATEGORIES = new Set(['build', 'fix', 'test', 'research']);

const BOARD_LOG_MAX = 500;
const BOARD_LOG_LEVELS = new Set(['info', 'warn', 'error']);
const BOARD_LOG_TYPES = new Set([
  'board_init',
  'mode_change',
  'auto_start',
  'auto_stop',
  'task_status',
  'task_started',
  'build_verdict',
  'test_verdict',
  'merge_result',
  'worktree_allocated',
  'task_retry',
  'task_error',
  'tool_call',
  'terminal_run',
  'dev_server',
  'final_test_started',
  'final_test_verdict',
]);
const BOARD_LOG_DETAIL_STRING_KEYS = new Set([
  'branch',
  'toolName',
  'argsPreview',
  'resultPreview',
  'command',
  'runId',
  'chatId',
  'error',
  'summary',
]);
const BOARD_LOG_DETAIL_NUMBER_KEYS = new Set(['attempt', 'devPort', 'apiPort', 'exitCode']);
const BOARD_LOG_DETAIL_STATUS_KEYS = new Set(['from', 'to']);
const BOARD_LOG_DETAIL_ENUMS = {
  verdict: new Set(['pass', 'fail']),
  attemptKind: new Set(['build', 'test', 'fixer']),
  mode: new Set(['manual', 'auto', 'sequential', 'afk']),
  outcome: new Set(['merged', 'conflict', 'error', 'skipped']),
};
const BOARD_LOG_STRING_MAX = 2000;

function truncateBoardLogString(value, max = BOARD_LOG_STRING_MAX) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function ensureBoardLogDetail(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const out = {};
  for (const key of BOARD_LOG_DETAIL_STRING_KEYS) {
    if (typeof r[key] === 'string' && r[key].trim()) {
      out[key] = truncateBoardLogString(r[key]);
    }
  }
  for (const key of BOARD_LOG_DETAIL_NUMBER_KEYS) {
    if (typeof r[key] === 'number' && Number.isFinite(r[key])) {
      out[key] = r[key];
    }
  }
  for (const key of BOARD_LOG_DETAIL_STATUS_KEYS) {
    const val = typeof r[key] === 'string' ? r[key] : '';
    if (BOARD_TASK_STATUSES.has(val)) out[key] = val;
  }
  for (const [key, allowed] of Object.entries(BOARD_LOG_DETAIL_ENUMS)) {
    if (typeof r[key] === 'string' && allowed.has(r[key])) {
      out[key] = r[key];
    }
  }
  if (Array.isArray(r.failingTaskIds)) {
    const failingTaskIds = [];
    for (const item of r.failingTaskIds) {
      if (typeof item === 'string' && item.trim()) failingTaskIds.push(item.trim());
    }
    if (failingTaskIds.length) out.failingTaskIds = failingTaskIds;
  }
  return Object.keys(out).length ? out : undefined;
}

function ensureBoardLogEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const ts = typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : null;
  const typeRaw = typeof r.type === 'string' ? r.type.trim() : '';
  if (!id || ts === null || !BOARD_LOG_TYPES.has(typeRaw)) return null;
  const levelRaw = typeof r.level === 'string' ? r.level.trim() : 'info';
  const level = BOARD_LOG_LEVELS.has(levelRaw) ? levelRaw : 'info';
  const message =
    typeof r.message === 'string' ? truncateBoardLogString(r.message, BOARD_LOG_STRING_MAX) : '';
  const out = { id, ts, type: typeRaw, level, message };
  if (typeof r.taskId === 'string' && r.taskId.trim()) {
    out.taskId = r.taskId.trim();
  }
  const detail = ensureBoardLogDetail(r.detail);
  if (detail) out.detail = detail;
  return out;
}

function ensureBoardWaveId(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

function ensureBoardCategory(raw) {
  return typeof raw === 'string' && BOARD_CATEGORIES.has(raw) ? raw : null;
}

function ensureBoardTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title : '';
  const wave = ensureBoardWaveId(r.wave);
  const category = ensureBoardCategory(r.category);
  const statusRaw = typeof r.status === 'string' ? r.status : '';
  if (!id || wave === null || !category || !BOARD_TASK_STATUSES.has(statusRaw)) return null;
  const out = { id, title, wave, category, status: statusRaw };
  if (typeof r.assignedRunId === 'string' && r.assignedRunId.trim()) {
    out.assignedRunId = r.assignedRunId.trim();
  }
  if (typeof r.startedAt === 'number') out.startedAt = r.startedAt;
  if (typeof r.endedAt === 'number') out.endedAt = r.endedAt;
  if (typeof r.filesChanged === 'number' && Number.isFinite(r.filesChanged)) {
    out.filesChanged = r.filesChanged;
  }
  if (typeof r.notes === 'string') out.notes = r.notes;
  if (typeof r.error === 'string') out.error = r.error;
  if (typeof r.lastRunId === 'string' && r.lastRunId.trim()) {
    out.lastRunId = r.lastRunId.trim();
  }
  if (Array.isArray(r.runHistory)) {
    const runHistory = [];
    for (const item of r.runHistory) {
      if (typeof item === 'string' && item.trim() && !runHistory.includes(item.trim())) {
        runHistory.push(item.trim());
      }
    }
    if (runHistory.length) out.runHistory = runHistory;
  }
  if (typeof r.chatId === 'string' && r.chatId.trim()) {
    out.chatId = r.chatId.trim();
  }
  if (typeof r.testChatId === 'string' && r.testChatId.trim()) {
    out.testChatId = r.testChatId.trim();
  }
  if (typeof r.fixerChatId === 'string' && r.fixerChatId.trim()) {
    out.fixerChatId = r.fixerChatId.trim();
  }
  if (typeof r.buildSpec === 'string' && r.buildSpec.trim()) {
    out.buildSpec = r.buildSpec.trim();
  }
  if (typeof r.testSpec === 'string' && r.testSpec.trim()) {
    out.testSpec = r.testSpec.trim();
  }
  if (Array.isArray(r.dependsOn)) {
    const dependsOn = [];
    for (const item of r.dependsOn) {
      if (typeof item === 'string' && item.trim()) dependsOn.push(item.trim());
    }
    if (dependsOn.length) out.dependsOn = dependsOn;
  }
  if (typeof r.testAttempts === 'number' && Number.isFinite(r.testAttempts)) {
    out.testAttempts = r.testAttempts;
  }
  if (typeof r.buildAttempts === 'number' && Number.isFinite(r.buildAttempts)) {
    out.buildAttempts = r.buildAttempts;
  }
  if (r.testVerdict === 'pass' || r.testVerdict === 'fail') {
    out.testVerdict = r.testVerdict;
  }
  if (typeof r.testSummary === 'string' && r.testSummary.trim()) {
    out.testSummary = r.testSummary.trim();
  }
  if (r.boardReport && typeof r.boardReport === 'object') {
    const br = /** @type {Record<string, unknown>} */ (r.boardReport);
    const outcome = typeof br.outcome === 'string' ? br.outcome.trim() : '';
    const summary = typeof br.summary === 'string' ? br.summary.trim() : '';
    if (
      (outcome === 'pass' || outcome === 'fail' || outcome === 'env_blocked') &&
      summary
    ) {
      const boardReport = { outcome, summary };
      if (Array.isArray(br.blockers)) {
        const blockers = [];
        for (const item of br.blockers) {
          if (typeof item === 'string' && item.trim()) blockers.push(item.trim());
        }
        if (blockers.length) boardReport.blockers = blockers;
      }
      out.boardReport = boardReport;
    }
  }
  if (typeof r.pendingBuildSeed === 'string' && r.pendingBuildSeed.trim()) {
    out.pendingBuildSeed = r.pendingBuildSeed.trim();
  }
  if (typeof r.worktreePath === 'string' && r.worktreePath.trim()) {
    out.worktreePath = r.worktreePath.trim();
  }
  if (typeof r.worktreeBranch === 'string' && r.worktreeBranch.trim()) {
    out.worktreeBranch = r.worktreeBranch.trim();
  }
  if (typeof r.devPort === 'number' && Number.isFinite(r.devPort)) {
    out.devPort = r.devPort;
  }
  if (typeof r.apiPort === 'number' && Number.isFinite(r.apiPort)) {
    out.apiPort = r.apiPort;
  }
  // quarantine payload
  if (r.quarantine && typeof r.quarantine === 'object') {
    const q = /** @type {Record<string, unknown>} */ (r.quarantine);
    const QUARANTINE_CATEGORIES = new Set(['infra', 'code', 'merge', 'stall', 'unknown']);
    const category = typeof q.category === 'string' && QUARANTINE_CATEGORIES.has(q.category) ? q.category : null;
    const summary = typeof q.summary === 'string' ? q.summary : null;
    const at = typeof q.at === 'number' && Number.isFinite(q.at) ? q.at : null;
    if (category && summary !== null && at !== null) {
      const quarantine = { category, summary, at };
      if (Array.isArray(q.resolutionSteps)) {
        const steps = [];
        for (const s of q.resolutionSteps) {
          if (typeof s === 'string') steps.push(s);
        }
        quarantine.resolutionSteps = steps;
      } else {
        quarantine.resolutionSteps = [];
      }
      if (typeof q.logRef === 'string' && q.logRef.trim()) {
        quarantine.logRef = q.logRef.trim();
      }
      out.quarantine = quarantine;
    }
  }
  if (typeof r.selfHealRound === 'number' && Number.isFinite(r.selfHealRound)) {
    out.selfHealRound = r.selfHealRound;
  }
  if (typeof r.lastHealCategory === 'string' && r.lastHealCategory.trim()) {
    out.lastHealCategory = r.lastHealCategory.trim();
  }
  if (typeof r.buildOutcome === 'string' && r.buildOutcome.trim()) {
    out.buildOutcome = r.buildOutcome.trim();
  }
  if (Array.isArray(r.buildBlockers)) {
    const buildBlockers = [];
    for (const item of r.buildBlockers) {
      if (typeof item === 'string' && item.trim()) buildBlockers.push(item.trim());
    }
    if (buildBlockers.length) out.buildBlockers = buildBlockers;
  }
  return out;
}

function ensureOrchestrateFinalTest(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const statusRaw = typeof r.status === 'string' ? r.status.trim() : '';
  const status =
    statusRaw === 'pending' ||
    statusRaw === 'in_progress' ||
    statusRaw === 'passed' ||
    statusRaw === 'failed'
      ? statusRaw
      : undefined;
  if (!status) return undefined;
  const out = { status };
  if (typeof r.chatId === 'string' && r.chatId.trim()) {
    out.chatId = r.chatId.trim();
  }
  if (typeof r.attempts === 'number') out.attempts = r.attempts;
  if (r.recordedVerdict === 'pass' || r.recordedVerdict === 'fail') {
    out.recordedVerdict = r.recordedVerdict;
  }
  if (Array.isArray(r.failingTaskIds)) {
    const failingTaskIds = [];
    for (const item of r.failingTaskIds) {
      if (typeof item === 'string' && item.trim()) failingTaskIds.push(item.trim());
    }
    if (failingTaskIds.length) out.failingTaskIds = failingTaskIds;
  }
  if (typeof r.summary === 'string' && r.summary.trim()) {
    out.summary = r.summary.trim();
  }
  return out;
}

function ensureOrchestrateBoard(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const planPath = typeof r.planPath === 'string' ? r.planPath.trim() : '';
  if (!planPath || !Array.isArray(r.tasks) || !Array.isArray(r.waves)) return undefined;
  const tasks = [];
  for (const item of r.tasks) {
    const task = ensureBoardTask(item);
    if (task) tasks.push(task);
  }
  if (!tasks.length) return undefined;
  const waves = [];
  for (const item of r.waves) {
    if (!item || typeof item !== 'object') continue;
    const w = /** @type {Record<string, unknown>} */ (item);
    const id = ensureBoardWaveId(w.id);
    const statusRaw = typeof w.status === 'string' ? w.status : 'planned';
    const status = BOARD_TASK_STATUSES.has(statusRaw) ? statusRaw : 'planned';
    if (id === null) continue;
    const wave = { id, status };
    if (typeof w.taskCount === 'number') wave.taskCount = w.taskCount;
    if (typeof w.completeCount === 'number') wave.completeCount = w.completeCount;
    if (w.collapsed === true) wave.collapsed = true;
    waves.push(wave);
  }
  if (!waves.length) return undefined;
  const startedAt = typeof r.startedAt === 'number' ? r.startedAt : Date.now();
  const lastUpdatedAt = typeof r.lastUpdatedAt === 'number' ? r.lastUpdatedAt : startedAt;
  const out = { planPath, tasks, waves, startedAt, lastUpdatedAt };
  if (typeof r.activeParentTurnId === 'string' && r.activeParentTurnId.trim()) {
    out.activeParentTurnId = r.activeParentTurnId.trim();
  }
  if (typeof r.timerAccumulatedMs === 'number') {
    out.timerAccumulatedMs = r.timerAccumulatedMs;
  }
  if (typeof r.timerSegmentStartedAt === 'number') {
    out.timerSegmentStartedAt = r.timerSegmentStartedAt;
  }
  if (typeof r.maxConcurrentTasks === 'number' && r.maxConcurrentTasks > 0) {
    out.maxConcurrentTasks = r.maxConcurrentTasks;
  }
  if (typeof r.completionShownAt === 'number') {
    out.completionShownAt = r.completionShownAt;
  }
  if (r.dashboardDismissed === true) out.dashboardDismissed = true;
  if (typeof r.finishReport === 'string' && r.finishReport.trim()) {
    out.finishReport = r.finishReport.trim();
  }
  const executionModeRaw =
    typeof r.executionMode === 'string' ? r.executionMode.trim() : '';
  const executionMode =
    executionModeRaw === 'auto' ||
    executionModeRaw === 'manual' ||
    executionModeRaw === 'sequential' ||
    executionModeRaw === 'afk'
      ? executionModeRaw
      : 'manual';
  out.executionMode = executionMode;
  if (r.autoRunning === true) out.autoRunning = true;
  if (r.pendingAfk === true) out.pendingAfk = true;
  const isolationModeRaw =
    typeof r.isolationMode === 'string' ? r.isolationMode.trim() : '';
  if (
    isolationModeRaw === 'off' ||
    isolationModeRaw === 'per-task' ||
    isolationModeRaw === 'per-wave'
  ) {
    out.isolationMode = isolationModeRaw;
  }
  if (typeof r.integrationBranch === 'string' && r.integrationBranch.trim()) {
    out.integrationBranch = r.integrationBranch.trim();
  }
  const finalTest = ensureOrchestrateFinalTest(r.finalTest);
  if (finalTest) out.finalTest = finalTest;
  if (r.userStopped === true) out.userStopped = true;
  if (typeof r.isolationBaseRef === 'string' && r.isolationBaseRef.trim()) {
    out.isolationBaseRef = r.isolationBaseRef.trim();
  }
  const PROVISION_STATES = new Set(['idle', 'provisioning', 'ready', 'failed']);
  if (typeof r.provisionState === 'string' && PROVISION_STATES.has(r.provisionState)) {
    out.provisionState = r.provisionState;
  }
  if (Array.isArray(r.provisionedSignatures)) {
    const sigs = [];
    for (const s of r.provisionedSignatures) {
      if (typeof s === 'string' && s.trim()) sigs.push(s.trim());
    }
    if (sigs.length) out.provisionedSignatures = sigs;
  }
  if (Array.isArray(r.unresolvedIssues)) {
    const UNRESOLVED_ISSUES_MAX = 200;
    const issues = [];
    for (const item of r.unresolvedIssues) {
      if (!item || typeof item !== 'object') continue;
      const u = /** @type {Record<string, unknown>} */ (item);
      if (
        typeof u.taskId === 'string' && u.taskId.trim() &&
        typeof u.title === 'string' &&
        typeof u.category === 'string' &&
        typeof u.summary === 'string' &&
        Array.isArray(u.resolutionSteps) &&
        typeof u.createdAt === 'number'
      ) {
        issues.push({
          taskId: u.taskId.trim(),
          title: u.title,
          category: u.category,
          summary: u.summary,
          resolutionSteps: u.resolutionSteps.filter((s) => typeof s === 'string'),
          ...(typeof u.logRef === 'string' && u.logRef.trim() ? { logRef: u.logRef.trim() } : {}),
          createdAt: u.createdAt,
          ...(typeof u.attempts === 'number' ? { attempts: u.attempts } : {}),
        });
      }
    }
    if (issues.length) out.unresolvedIssues = issues.slice(-UNRESOLVED_ISSUES_MAX);
  }
  if (Array.isArray(r.log)) {
    const log = [];
    for (const item of r.log) {
      const e = ensureBoardLogEvent(item);
      if (e) log.push(e);
    }
    if (log.length) out.log = log.slice(-BOARD_LOG_MAX);
  }
  return out;
}

/** Sidebar chat folder (schema v4+). */
function ensureChatGroup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  const workspacePath =
    typeof r.workspacePath === 'string'
      ? normalizeWorkspacePath(r.workspacePath)
      : '';
  if (!id || !name) return null;
  const orchestrateBoard = ensureOrchestrateBoard(r.orchestrateBoard);
  const orchestratePlanPath = normalizeOrchestratePlanPath(r.orchestratePlanPath);
  const viewMode = ensureViewMode(r.viewMode);
  const plannerChatId =
    typeof r.plannerChatId === 'string' && r.plannerChatId.trim()
      ? r.plannerChatId.trim()
      : undefined;
  return {
    id,
    name,
    workspacePath,
    collapsed: r.collapsed === true,
    order: typeof r.order === 'number' ? r.order : 0,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    ...(orchestrateBoard ? { orchestrateBoard } : {}),
    ...(orchestratePlanPath ? { orchestratePlanPath } : {}),
    ...(viewMode ? { viewMode } : {}),
    ...(plannerChatId ? { plannerChatId } : {}),
  };
}

/** Coerce persisted sidebar folders. */
function ensureGroupsFromRaw(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const group = ensureChatGroup(item);
    if (group) out.push(group);
  }
  return out;
}

const BUG_COLUMNS = new Set([
  'reported',
  'investigating',
  'planned',
  'fixing',
  'complete',
]);
const BUG_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function ensureBugCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title : '';
  const description = typeof r.description === 'string' ? r.description : '';
  const severityRaw = typeof r.severity === 'string' ? r.severity : 'medium';
  const columnRaw = typeof r.column === 'string' ? r.column : 'reported';
  if (!id || !BUG_SEVERITIES.has(severityRaw) || !BUG_COLUMNS.has(columnRaw)) return null;
  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : Date.now();
  const updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : createdAt;
  const out = {
    id,
    title,
    description,
    severity: severityRaw,
    column: columnRaw,
    createdAt,
    updatedAt,
  };
  if (typeof r.notes === 'string') out.notes = r.notes;
  if (typeof r.planPath === 'string' && r.planPath.trim()) out.planPath = r.planPath.trim();
  if (typeof r.investigateRunId === 'string' && r.investigateRunId.trim()) {
    out.investigateRunId = r.investigateRunId.trim();
  }
  if (typeof r.planRunId === 'string' && r.planRunId.trim()) {
    out.planRunId = r.planRunId.trim();
  }
  if (typeof r.fixRunId === 'string' && r.fixRunId.trim()) {
    out.fixRunId = r.fixRunId.trim();
  }
  if (typeof r.workspacePath === 'string') {
    out.workspacePath = normalizeWorkspacePath(r.workspacePath);
  } else {
    out.workspacePath = '';
  }
  if (typeof r.chatId === 'string' && r.chatId.trim()) {
    out.chatId = r.chatId.trim();
  }
  return out;
}

function ensureBugBoard(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (!Array.isArray(r.bugs)) return undefined;
  const bugs = [];
  for (const item of r.bugs) {
    const card = ensureBugCard(item);
    if (card) bugs.push(card);
  }
  const startedAt = typeof r.startedAt === 'number' ? r.startedAt : Date.now();
  const lastUpdatedAt = typeof r.lastUpdatedAt === 'number' ? r.lastUpdatedAt : startedAt;
  return { bugs, startedAt, lastUpdatedAt };
}

/** Validate ~/.minnow/bugs/state.json */
export function validateBugsState(raw) {
  if (!raw || typeof raw !== 'object') {
    return { version: 1, bugs: [] };
  }
  const row = /** @type {Record<string, unknown>} */ (raw);
  if (row.version !== 1 || !Array.isArray(row.bugs)) {
    return { version: 1, bugs: [] };
  }
  const bugs = [];
  for (const item of row.bugs) {
    const card = ensureBugCard(item);
    if (card) bugs.push(card);
  }
  return { version: 1, bugs };
}

function ensureViewMode(raw) {
  return raw === 'chat' || raw === 'board' ? raw : undefined;
}

const GENERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persisted backend generation id for reload re-subscribe. */
function ensureCurrentGenerationId(raw) {
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim();
  return GENERATION_ID_RE.test(id) ? id : undefined;
}

/** Coerce /goal loop state (mirror src/state/sessions.ts ensureActiveGoal). */
function ensureActiveGoal(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const goal = /** @type {Record<string, unknown>} */ (raw);
  const conditionText =
    typeof goal.conditionText === 'string' ? goal.conditionText.trim() : '';
  if (!conditionText) return undefined;
  return {
    conditionText: conditionText.slice(0, MAX_GOAL_CONDITION_CHARS),
    startedAt:
      typeof goal.startedAt === 'number' && Number.isFinite(goal.startedAt)
        ? goal.startedAt
        : Date.now(),
    turnCount:
      typeof goal.turnCount === 'number' && Number.isFinite(goal.turnCount)
        ? Math.max(0, Math.floor(goal.turnCount))
        : 0,
    tokenBaseline:
      typeof goal.tokenBaseline === 'number' && Number.isFinite(goal.tokenBaseline)
        ? Math.max(0, Math.floor(goal.tokenBaseline))
        : 0,
    ...(typeof goal.lastReason === 'string' && goal.lastReason.trim()
      ? { lastReason: goal.lastReason.trim() }
      : {}),
    ...(goal.achieved === true ? { achieved: true } : {}),
  };
}

function ensureChatShape(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      id: newChatId(),
      name: PLACEHOLDER_CHAT_NAME,
      workspacePath: '',
      modelId: '',
      modeId: DEFAULT_MODE_ID,
      expertSelection: defaultExpertSelection(),
      lastResolvedExpertId: null,
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: Date.now(),
    };
  }

  const row = /** @type {Record<string, unknown>} */ (raw);
  const history = Array.isArray(row.history)
    ? row.history.filter((m) => m && typeof m === 'object' && m.role)
    : [];

  const terminalHistory = Array.isArray(row.terminalHistory)
    ? row.terminalHistory.filter((r) => r && typeof r === 'object')
    : undefined;

  const workspacePath =
    typeof row.workspacePath === 'string'
      ? normalizeWorkspacePath(row.workspacePath)
      : '';

  const currentGenerationId = ensureCurrentGenerationId(row.currentGenerationId);

  const orchestratePlanPath = normalizeOrchestratePlanPath(row.orchestratePlanPath);
  const orchestrateBoard = ensureOrchestrateBoard(row.orchestrateBoard);
  const viewMode = ensureViewMode(row.viewMode);

  const runs = Array.isArray(row.runs)
    ? row.runs.filter((r) => r && typeof r === 'object')
    : undefined;
  const activeBranchByFork =
    row.activeBranchByFork && typeof row.activeBranchByFork === 'object'
      ? row.activeBranchByFork
      : undefined;
  const activeGoal = ensureActiveGoal(row.activeGoal);

  return {
    id: typeof row.id === 'string' && row.id ? row.id : newChatId(),
    name:
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : PLACEHOLDER_CHAT_NAME,
    workspacePath,
    modelId: typeof row.modelId === 'string' ? row.modelId : '',
    ...(typeof row.providerId === 'string' && row.providerId.trim()
      ? { providerId: row.providerId.trim() }
      : {}),
    modeId: normalizeModeId(
      typeof row.modeId === 'string' ? row.modeId : undefined,
    ),
    expertSelection: ensureExpertSelection(row.expertSelection),
    ...(orchestratePlanPath ? { orchestratePlanPath } : {}),
    ...(typeof row.groupId === 'string' && row.groupId.trim()
      ? { groupId: row.groupId.trim() }
      : {}),
    ...(typeof row.boardGroupId === 'string' && row.boardGroupId.trim()
      ? { boardGroupId: row.boardGroupId.trim() }
      : {}),
    ...(typeof row.boardTaskId === 'string' && row.boardTaskId.trim()
      ? { boardTaskId: row.boardTaskId.trim() }
      : {}),
    ...(typeof row.worktreeRoot === 'string' && row.worktreeRoot.trim()
      ? { worktreeRoot: row.worktreeRoot.trim() }
      : {}),
    ...(typeof row.workAgentId === 'string' && row.workAgentId.trim()
      ? { workAgentId: row.workAgentId.trim() }
      : {}),
    ...(row.workAgentAuto === false ? { workAgentAuto: false } : {}),
    ...(orchestrateBoard ? { orchestrateBoard } : {}),
    ...(viewMode ? { viewMode } : {}),
    ...(runs?.length ? { runs } : {}),
    ...(activeBranchByFork ? { activeBranchByFork } : {}),
    ...(terminalHistory?.length ? { terminalHistory } : {}),
    ...(currentGenerationId ? { currentGenerationId } : {}),
    ...(activeGoal ? { activeGoal } : {}),
    ...(row.unread === true ? { unread: true } : {}),
    ...(typeof row.lastAssistantAt === 'number' &&
    Number.isFinite(row.lastAssistantAt) &&
    row.lastAssistantAt > 0
      ? { lastAssistantAt: row.lastAssistantAt }
      : {}),
    history,
    lastStats: row.lastStats && typeof row.lastStats === 'object' ? row.lastStats : null,
    modelInfo: row.modelInfo && typeof row.modelInfo === 'object' ? row.modelInfo : {},
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
    lastMessageAt:
      typeof row.lastMessageAt === 'number'
        ? row.lastMessageAt
        : typeof row.updatedAt === 'number'
          ? row.updatedAt
          : Date.now(),
  };
}

function getChatLastMessageAt(chat) {
  const last = chat.lastMessageAt;
  if (typeof last === 'number' && Number.isFinite(last) && last > 0) return last;
  const updated = chat.updatedAt;
  return typeof updated === 'number' && Number.isFinite(updated) ? updated : 0;
}

function trimChatsIfNeeded(state) {
  if (!state.chats || state.chats.length <= MAX_CHATS) return;
  const activeId = state.activeId;
  const sortedOldestFirst = [...state.chats].sort(
    (a, b) => getChatLastMessageAt(a) - getChatLastMessageAt(b),
  );
  let toDrop = state.chats.length - MAX_CHATS;
  for (const c of sortedOldestFirst) {
    if (toDrop <= 0) break;
    if (c.id === activeId) continue;
    state.chats = state.chats.filter((x) => x.id !== c.id);
    toDrop -= 1;
  }
}

/**
 * @param {unknown} raw
 * @returns {object}
 */
export function validateSessionState(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid session state');
  }

  const parsed = /** @type {Record<string, unknown>} */ (raw);
  const version = parsed.version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5) {
    throw new Error('Invalid session version');
  }

  if (!Array.isArray(parsed.chats)) {
    throw new Error('Invalid session state');
  }

  const chats = parsed.chats.map(ensureChatShape).filter(Boolean);
  const groups = ensureGroupsFromRaw(parsed.groups);
  const state = {
    version: SESSION_SCHEMA_VERSION,
    activeId: typeof parsed.activeId === 'string' ? parsed.activeId : '',
    sidebarCollapsed: !!parsed.sidebarCollapsed,
    lastActiveChatIdByWorkspace: ensureLastActiveMap(parsed.lastActiveChatIdByWorkspace),
    groups,
    chats: chats.length ? chats : [ensureChatShape(null)],
  };
  if (
    typeof parsed.activeBoardGroupId === 'string' &&
    parsed.activeBoardGroupId.trim()
  ) {
    state.activeBoardGroupId = parsed.activeBoardGroupId.trim();
  }

  if (!state.chats.some((c) => c.id === state.activeId)) {
    state.activeId = state.chats[0].id;
  }

  trimChatsIfNeeded(state);

  if (!state.chats.length) {
    throw new Error('Session must have at least one chat');
  }

  return state;
}

/**
 * @param {unknown} raw
 * @returns {object}
 */
/** @param {unknown} value */
function isToolPermissionMode(value) {
  return value === 'full' || value === 'ask' || value === 'off';
}

/** @param {unknown} permissions */
function isLegacyFlatPermissions(permissions) {
  if (!permissions || typeof permissions !== 'object') return false;
  const obj = /** @type {Record<string, unknown>} */ (permissions);
  if (obj.default && typeof obj.default === 'object' && !Array.isArray(obj.default)) {
    return false;
  }
  for (const value of Object.values(obj)) {
    if (isToolPermissionMode(value)) return true;
  }
  return false;
}

/**
 * @param {unknown} stored
 * @param {Record<string, string>} seedDefault
 */
function normalizePermissionsFromStored(stored, seedDefault) {
  if (!stored || typeof stored !== 'object') {
    return { default: { ...seedDefault } };
  }

  if (isLegacyFlatPermissions(stored)) {
    const merged = { ...seedDefault };
    for (const [id, value] of Object.entries(/** @type {Record<string, unknown>} */ (stored))) {
      if (!id || !isToolPermissionMode(value)) continue;
      merged[id] = value;
    }
    return { default: merged };
  }

  const obj = /** @type {Record<string, unknown>} */ (stored);
  const merged = { ...seedDefault };
  if (obj.default && typeof obj.default === 'object') {
    for (const [id, value] of Object.entries(/** @type {Record<string, unknown>} */ (obj.default))) {
      if (!id || !isToolPermissionMode(value)) continue;
      merged[id] = value;
    }
  }

  return { default: merged };
}

/** True when a tool id was present in persisted tools.json (enabled or permissions). */
function toolIdWasStored(raw, id) {
  if (!raw || typeof raw !== 'object') return false;
  const stored = /** @type {Record<string, unknown>} */ (raw);
  if (stored.enabled && typeof stored.enabled === 'object') {
    if (Object.prototype.hasOwnProperty.call(stored.enabled, id)) return true;
  }
  if (stored.permissions && typeof stored.permissions === 'object') {
    if (isLegacyFlatPermissions(stored.permissions)) {
      if (Object.prototype.hasOwnProperty.call(stored.permissions, id)) return true;
    } else {
      const def = /** @type {Record<string, unknown>} */ (stored.permissions).default;
      if (def && typeof def === 'object' && Object.prototype.hasOwnProperty.call(def, id)) {
        return true;
      }
    }
  }
  return false;
}

/** Insert missing Brain tool ids at `full` for upgraded configs (Correction 6). */
function backfillBrainTools(config, raw) {
  for (const id of BRAIN_FULL_PERMISSION_TOOL_IDS) {
    if (!toolIdWasStored(raw, id)) {
      config.permissions.default[id] = 'full';
      config.enabled[id] = true;
    }
  }
  for (const id of ARCHIVE_RECALL_TOOL_IDS) {
    if (!toolIdWasStored(raw, id)) {
      config.permissions.default[id] = 'ask';
      config.enabled[id] = true;
    }
  }
  for (const id of BRAIN_DESTRUCTIVE_TOOL_IDS) {
    if (!toolIdWasStored(raw, id)) {
      config.permissions.default[id] = 'ask';
      config.enabled[id] = true;
    }
  }
}

/** Clamp archive policy numeric fields (MIN-139). */
export function normalizeArchiveConfig(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = /** @type {Record<string, unknown>} */ (raw);
  const out = {};
  const staleness = Number(row.stalenessTurns);
  if (Number.isFinite(staleness)) {
    out.stalenessTurns = Math.min(200, Math.max(1, Math.floor(staleness)));
  }
  const pressure = Number(row.pressureThreshold);
  if (Number.isFinite(pressure)) {
    out.pressureThreshold = Math.min(0.99, Math.max(0.1, pressure));
  }
  const minRecent = Number(row.minRecentTurns);
  if (Number.isFinite(minRecent)) {
    out.minRecentTurns = Math.min(50, Math.max(1, Math.floor(minRecent)));
  }
  const topK = Number(row.retrievalTopK);
  if (Number.isFinite(topK)) {
    out.retrievalTopK = Math.min(20, Math.max(1, Math.floor(topK)));
  }
  if (typeof row.embeddingModelId === 'string' && row.embeddingModelId.trim()) {
    out.embeddingModelId = row.embeddingModelId.trim().slice(0, 128);
  }
  if (typeof row.llmRerank === 'boolean') {
    out.llmRerank = row.llmRerank;
  }
  return Object.keys(out).length ? out : undefined;
}

function defaultPermissionForTool(id, enabled) {
  if (BRAIN_FULL_PERMISSION_TOOL_ID_SET.has(id)) {
    return enabled ? 'full' : 'off';
  }
  return enabled ? 'ask' : 'off';
}

export function normalizeToolConfig(raw) {
  const DEFAULT_ENABLED_TOOL_IDS = new Set([
    'get_datetime',
    'calculate',
    'web_search',
    'wikipedia_search',
    'save_memory',
    'ask_question',
    'brain_search',
    'brain_read_page',
    'brain_list',
    'brain_write_page',
    'brain_append_log',
    'brain_ingest_source',
    'manage_brain',
    'repo_map',
    'find_symbol',
    'who_calls',
    'read_symbol',
    'explain_symbol',
  ]);
  const enabled = {};
  const permissionsDefault = {};
  for (const id of ALL_TOOL_IDS) {
    const on = DEFAULT_ENABLED_TOOL_IDS.has(id);
    enabled[id] = on;
    permissionsDefault[id] = defaultPermissionForTool(id, on);
  }

  const config = {
    enabled,
    permissions: { default: permissionsDefault },
    keys: { braveApiKey: '', tavilyApiKey: '' },
    webSearchProvider: 'duckduckgo',
    toolCache: { enabled: true },
    plugins: {},
  };

  if (!raw || typeof raw !== 'object') return config;

  const stored = /** @type {Record<string, unknown>} */ (raw);
  if (stored.enabled && typeof stored.enabled === 'object') {
    const enabledMap = /** @type {Record<string, unknown>} */ (stored.enabled);
    for (const id of ALL_TOOL_IDS) {
      if (typeof enabledMap[id] === 'boolean') {
        config.enabled[id] = enabledMap[id];
      }
    }
  }

  let hadPermissionsInFile = false;
  if (stored.permissions && typeof stored.permissions === 'object') {
    hadPermissionsInFile =
      isLegacyFlatPermissions(stored.permissions) ||
      (typeof /** @type {Record<string, unknown>} */ (stored.permissions).default === 'object' &&
        /** @type {Record<string, unknown>} */ (stored.permissions).default !== null);
    config.permissions = normalizePermissionsFromStored(
      stored.permissions,
      config.permissions.default,
    );
  }

  if (!hadPermissionsInFile) {
    for (const id of ALL_TOOL_IDS) {
      config.permissions.default[id] = defaultPermissionForTool(id, config.enabled[id] === true);
    }
  } else {
    for (const id of ALL_TOOL_IDS) {
      const v = config.permissions.default[id];
      if (!isToolPermissionMode(v)) {
        config.permissions.default[id] = defaultPermissionForTool(id, config.enabled[id] === true);
      }
    }
  }

  backfillBrainTools(config, raw);

  for (const id of ALL_TOOL_IDS) {
    const mode = config.permissions.default[id];
    config.enabled[id] = mode !== 'off';
  }

  if (stored.keys && typeof stored.keys === 'object') {
    const keysMap = /** @type {Record<string, unknown>} */ (stored.keys);
    if (typeof keysMap.braveApiKey === 'string') {
      config.keys.braveApiKey = keysMap.braveApiKey;
    }
    if (typeof keysMap.tavilyApiKey === 'string') {
      config.keys.tavilyApiKey = keysMap.tavilyApiKey;
    }
  }

  if (
    stored.webSearchProvider === 'brave' ||
    stored.webSearchProvider === 'tavily' ||
    stored.webSearchProvider === 'duckduckgo'
  ) {
    config.webSearchProvider = stored.webSearchProvider;
  }

  if (stored.toolCache && typeof stored.toolCache === 'object') {
    const cacheMap = /** @type {Record<string, unknown>} */ (stored.toolCache);
    if (typeof cacheMap.enabled === 'boolean') {
      config.toolCache = { enabled: cacheMap.enabled };
    }
  }
  if (!config.toolCache) {
    config.toolCache = { enabled: true };
  }

  if (stored.plugins && typeof stored.plugins === 'object') {
    const pluginsMap = /** @type {Record<string, unknown>} */ (stored.plugins);
    for (const [pluginId, meta] of Object.entries(pluginsMap)) {
      if (!pluginId.trim() || typeof meta !== 'object' || meta === null) continue;
      const row = /** @type {Record<string, unknown>} */ (meta);
      config.plugins[pluginId.trim()] = {
        enabled: row.enabled !== false,
      };
    }
  }

  return config;
}

/**
 * @param {unknown} raw
 * @returns {{ enabled: Record<string, boolean> }}
 */
export function normalizeSkillConfig(raw) {
  const config = { enabled: {} };

  if (!raw || typeof raw !== 'object') return config;

  const stored = /** @type {Record<string, unknown>} */ (raw);
  if (!stored.enabled || typeof stored.enabled !== 'object') return config;

  const enabledMap = /** @type {Record<string, unknown>} */ (stored.enabled);
  for (const [id, value] of Object.entries(enabledMap)) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) continue;
    if (typeof value === 'boolean') {
      config.enabled[id] = value;
    }
  }

  return config;
}

/**
 * @param {unknown} raw
 * @returns {{ presetId: string, text: string }}
 */
export function validateSystemPromptSettings(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid system prompt settings');
  }

  const parsed = /** @type {Record<string, unknown>} */ (raw);
  return {
    presetId: typeof parsed.presetId === 'string' ? parsed.presetId : '',
    text: typeof parsed.text === 'string' ? parsed.text : '',
  };
}

const MAX_USER_RULES_BYTES = 16 * 1024;

/**
 * @param {unknown} raw
 * @returns {{ version: 1, enabled: boolean, text: string }}
 */
export function validateUserRulesSettings(raw) {
  if (!raw || typeof raw !== 'object') {
    const err = new Error('Invalid user rules settings');
    err.statusCode = 400;
    throw err;
  }

  const parsed = /** @type {Record<string, unknown>} */ (raw);
  const version = parsed.version === 1 ? 1 : 1;
  const enabled = parsed.enabled === true;
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_USER_RULES_BYTES) {
    const err = new Error(`User rules text exceeds ${MAX_USER_RULES_BYTES} bytes`);
    err.statusCode = 413;
    throw err;
  }

  return { version, enabled, text };
}

const SUPERVISOR_DEFAULTS = {
  enabled: true,
  autoResume: true,
  repetitionDetection: true,
  llmEscalation: true,
  askUserOnBudgetExhausted: true,
  stallMs: 30_000,
  maxRetriesPerTask: 3,
  orchestratorHeartbeatMs: 90_000,
  inProgressNoRunMs: 45_000,
  spawnStuckMs: 30_000,
  parentSilenceAfterToolMs: 20_000,
  subAgentToolSilenceMs: 60_000,
  runRestartCap: 2,
  spawnCapPerTask: 3,
  llmEscalationsPerSession: 10,
  llmEscalationTimeoutMs: 8_000,
  tickIntervalMs: 5_000,
  repetition: {
    duplicateToolCallThreshold: 3,
    sameErrorThreshold: 3,
    maxRestartsPerRun: 2,
  },
  escalationProviderId: '',
  escalationModelId: '',
};

/**
 * Deep-merge `supervisor` config with clamps (server + tests).
 * @param {Record<string, unknown>} patch
 * @param {Record<string, unknown>} base
 * @returns {object}
 */
export function mergeSupervisorConfig(patch, base) {
  const out = {
    ...SUPERVISOR_DEFAULTS,
    ...(base && typeof base === 'object' ? base : {}),
    repetition: {
      ...SUPERVISOR_DEFAULTS.repetition,
      ...(base?.repetition && typeof base.repetition === 'object' ? base.repetition : {}),
    },
  };
  if (!patch || typeof patch !== 'object') return out;
  const p = /** @type {Record<string, unknown>} */ (patch);

  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  if (typeof p.autoResume === 'boolean') out.autoResume = p.autoResume;
  if (typeof p.repetitionDetection === 'boolean') out.repetitionDetection = p.repetitionDetection;
  if (typeof p.llmEscalation === 'boolean') out.llmEscalation = p.llmEscalation;
  if (typeof p.askUserOnBudgetExhausted === 'boolean') {
    out.askUserOnBudgetExhausted = p.askUserOnBudgetExhausted;
  }
  if (typeof p.stallMs === 'number' && Number.isFinite(p.stallMs)) {
    out.stallMs = Math.min(600_000, Math.max(5_000, Math.round(p.stallMs)));
  }
  if (typeof p.maxRetriesPerTask === 'number' && Number.isFinite(p.maxRetriesPerTask)) {
    out.maxRetriesPerTask = Math.min(10, Math.max(0, Math.round(p.maxRetriesPerTask)));
  }
  if (typeof p.orchestratorHeartbeatMs === 'number' && Number.isFinite(p.orchestratorHeartbeatMs)) {
    out.orchestratorHeartbeatMs = Math.min(600_000, Math.max(10_000, Math.round(p.orchestratorHeartbeatMs)));
  }
  if (typeof p.inProgressNoRunMs === 'number' && Number.isFinite(p.inProgressNoRunMs)) {
    out.inProgressNoRunMs = Math.min(300_000, Math.max(10_000, Math.round(p.inProgressNoRunMs)));
  }
  if (typeof p.spawnStuckMs === 'number' && Number.isFinite(p.spawnStuckMs)) {
    out.spawnStuckMs = Math.min(120_000, Math.max(5_000, Math.round(p.spawnStuckMs)));
  }
  if (typeof p.parentSilenceAfterToolMs === 'number' && Number.isFinite(p.parentSilenceAfterToolMs)) {
    out.parentSilenceAfterToolMs = Math.min(120_000, Math.max(5_000, Math.round(p.parentSilenceAfterToolMs)));
  }
  if (typeof p.subAgentToolSilenceMs === 'number' && Number.isFinite(p.subAgentToolSilenceMs)) {
    out.subAgentToolSilenceMs = Math.min(300_000, Math.max(10_000, Math.round(p.subAgentToolSilenceMs)));
  }
  if (typeof p.runRestartCap === 'number' && Number.isFinite(p.runRestartCap)) {
    out.runRestartCap = Math.min(20, Math.max(0, Math.round(p.runRestartCap)));
  }
  if (typeof p.spawnCapPerTask === 'number' && Number.isFinite(p.spawnCapPerTask)) {
    out.spawnCapPerTask = Math.min(20, Math.max(0, Math.round(p.spawnCapPerTask)));
  }
  if (typeof p.llmEscalationsPerSession === 'number' && Number.isFinite(p.llmEscalationsPerSession)) {
    out.llmEscalationsPerSession = Math.min(50, Math.max(0, Math.round(p.llmEscalationsPerSession)));
  }
  if (typeof p.llmEscalationTimeoutMs === 'number' && Number.isFinite(p.llmEscalationTimeoutMs)) {
    out.llmEscalationTimeoutMs = Math.min(60_000, Math.max(1_000, Math.round(p.llmEscalationTimeoutMs)));
  }
  if (typeof p.tickIntervalMs === 'number' && Number.isFinite(p.tickIntervalMs)) {
    out.tickIntervalMs = Math.min(60_000, Math.max(1_000, Math.round(p.tickIntervalMs)));
  }
  if (typeof p.escalationProviderId === 'string') out.escalationProviderId = p.escalationProviderId.trim();
  if (typeof p.escalationModelId === 'string') out.escalationModelId = p.escalationModelId.trim();

  const rep = p.repetition;
  if (rep && typeof rep === 'object') {
    const r = /** @type {Record<string, unknown>} */ (rep);
    if (typeof r.duplicateToolCallThreshold === 'number' && Number.isFinite(r.duplicateToolCallThreshold)) {
      out.repetition.duplicateToolCallThreshold = Math.min(10, Math.max(2, Math.round(r.duplicateToolCallThreshold)));
    }
    if (typeof r.sameErrorThreshold === 'number' && Number.isFinite(r.sameErrorThreshold)) {
      out.repetition.sameErrorThreshold = Math.min(10, Math.max(2, Math.round(r.sameErrorThreshold)));
    }
    if (typeof r.maxRestartsPerRun === 'number' && Number.isFinite(r.maxRestartsPerRun)) {
      out.repetition.maxRestartsPerRun = Math.min(10, Math.max(0, Math.round(r.maxRestartsPerRun)));
    }
  }

  return out;
}

/**
 * Merge allowed fields into config.json meta.
 * @param {object} existing
 * @param {unknown} patch
 * @returns {object}
 */
export function mergeConfigMeta(existing, patch) {
  const base =
    existing && typeof existing === 'object'
      ? { ...existing }
      : {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          migratedFromLocalStorage: false,
          migratedAt: null,
          localStorageKeysMigrated: [],
          layoutVersion: 1,
        };

  if (!patch || typeof patch !== 'object') return base;

  const p = /** @type {Record<string, unknown>} */ (patch);

  if (typeof p.migratedFromLocalStorage === 'boolean') {
    base.migratedFromLocalStorage = p.migratedFromLocalStorage;
  }
  if (p.migratedAt === null || typeof p.migratedAt === 'string') {
    base.migratedAt = p.migratedAt;
  }
  if (Array.isArray(p.localStorageKeysMigrated)) {
    base.localStorageKeysMigrated = p.localStorageKeysMigrated.filter(
      (k) => typeof k === 'string',
    );
  }
  if (typeof p.layoutVersion === 'number') {
    base.layoutVersion = p.layoutVersion;
  }
  if (typeof p.schemaVersion === 'number') {
    base.schemaVersion = p.schemaVersion;
  }

  if (p.titles && typeof p.titles === 'object') {
    const existingTitles =
      base.titles && typeof base.titles === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.titles) }
        : {
            enabled: true,
            modelId: '',
            providerId: '',
            maxTokens: 24,
            temperature: 0.3,
          };
    const t = /** @type {Record<string, unknown>} */ (p.titles);
    if (typeof t.enabled === 'boolean') existingTitles.enabled = t.enabled;
    if (typeof t.modelId === 'string') existingTitles.modelId = t.modelId;
    if (typeof t.providerId === 'string') existingTitles.providerId = t.providerId;
    if (typeof t.maxTokens === 'number' && Number.isFinite(t.maxTokens)) {
      existingTitles.maxTokens = Math.min(32, Math.max(16, Math.round(t.maxTokens)));
    }
    if (typeof t.temperature === 'number' && Number.isFinite(t.temperature)) {
      existingTitles.temperature = Math.min(0.4, Math.max(0.2, t.temperature));
    }
    base.titles = existingTitles;
  }

  if (p.thinking && typeof p.thinking === 'object') {
    const existingThinking =
      base.thinking && typeof base.thinking === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.thinking) }
        : { defaultMode: 'on' };
    const t = /** @type {Record<string, unknown>} */ (p.thinking);
    const mode = normalizeThinkingGlobalDefault(t.defaultMode);
    if (mode) existingThinking.defaultMode = mode;
    base.thinking = existingThinking;
  }

  if (p.sampler !== undefined) {
    if (p.sampler === null) {
      base.sampler = {
        temperature: 0.7,
        maxTokens: 32768,
      };
    } else if (typeof p.sampler === 'object') {
      const normalized = normalizeSamplerPreset(p.sampler);
      const existingSampler =
        base.sampler && typeof base.sampler === 'object'
          ? { .../** @type {Record<string, number>} */ (base.sampler) }
          : { temperature: 0.7, maxTokens: 32768 };
      if (normalized) {
        if (normalized.temperature !== undefined) {
          existingSampler.temperature = normalized.temperature;
        }
        if (normalized.topP !== undefined) existingSampler.topP = normalized.topP;
        if (normalized.topK !== undefined) existingSampler.topK = normalized.topK;
        if (normalized.minP !== undefined) existingSampler.minP = normalized.minP;
        if (normalized.repetitionPenalty !== undefined) {
          existingSampler.repetitionPenalty = normalized.repetitionPenalty;
        }
        if (normalized.presencePenalty !== undefined) {
          existingSampler.presencePenalty = normalized.presencePenalty;
        }
        if (normalized.maxTokens !== undefined) {
          existingSampler.maxTokens = normalized.maxTokens;
        }
      }
      const s = /** @type {Record<string, unknown>} */ (p.sampler);
      if (typeof s.maxTokens === 'number' && Number.isFinite(s.maxTokens)) {
        const mt = Math.min(131072, Math.max(1, Math.floor(s.maxTokens)));
        existingSampler.maxTokens = mt;
      }
      base.sampler = existingSampler;
    }
  }

  if (p.autopilot !== undefined) {
    const AUTOPILOT_EXECUTION_MODES = new Set(['manual', 'sequential', 'auto', 'afk']);
    const AUTOPILOT_ISOLATION_MODES = new Set(['auto', 'off', 'per-task', 'per-wave']);
    const clampAutopilotConcurrency = (value, fallback) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.min(20, Math.max(1, Math.round(value)));
    };
    const clampAutopilotAttempts = (value, fallback) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.min(10, Math.max(1, Math.round(value)));
    };
    const clampHeartbeatIntervalMs = (value, fallback) => {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(60_000, Math.max(1_000, Math.round(n)));
    };
    const clampProgressStallMs = (value, fallback) => {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(1_800_000, Math.max(10_000, Math.round(n)));
    };
    const clampHeartbeatDeadMs = (value, fallback) => {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(300_000, Math.max(5_000, Math.round(n)));
    };

    const clampSelfHealRounds = (value, fallback) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.min(6, Math.max(0, Math.round(value)));
    };
    const clampInfraTimeoutMs = (value, fallback) => {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(600_000, Math.max(30_000, Math.round(n)));
    };
    const parseBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
    const AUTOPILOT_DEFAULTS = {
      defaultExecutionMode: 'manual',
      maxConcurrentTasks: 3,
      isolationMode: 'auto',
      maxTestAttempts: 3,
      maxBuildAttempts: 2,
      maxFinalTestAttempts: 3,
      continueSmartRoute: 'conservative',
      heartbeatIntervalMs: 7000,
      progressStallMs: 90000,
      heartbeatDeadMs: 30000,
      plannerProviderId: '',
      plannerModelId: '',
      selfHealMaxRounds: 2,
      autoProvisionInfra: true,
      infraProvisionTimeoutMs: 180000,
      afkAutoRestartStalls: true,
      guardCdOutsideWorktree: true,
    };

    if (p.autopilot === null) {
      base.autopilot = { ...AUTOPILOT_DEFAULTS };
    } else if (typeof p.autopilot === 'object') {
      const existingAutopilot =
        base.autopilot && typeof base.autopilot === 'object'
          ? { .../** @type {Record<string, unknown>} */ (base.autopilot) }
          : { ...AUTOPILOT_DEFAULTS };
      const a = /** @type {Record<string, unknown>} */ (p.autopilot);
      if (typeof a.defaultExecutionMode === 'string') {
        const mode = a.defaultExecutionMode.trim();
        if (AUTOPILOT_EXECUTION_MODES.has(mode)) {
          existingAutopilot.defaultExecutionMode = mode;
        }
      }
      if (a.maxConcurrentTasks !== undefined) {
        existingAutopilot.maxConcurrentTasks = clampAutopilotConcurrency(
          a.maxConcurrentTasks,
          existingAutopilot.maxConcurrentTasks ?? 3,
        );
      }
      if (typeof a.isolationMode === 'string') {
        const iso = a.isolationMode.trim();
        if (AUTOPILOT_ISOLATION_MODES.has(iso)) {
          existingAutopilot.isolationMode = iso;
        }
      }
      if (a.maxTestAttempts !== undefined) {
        existingAutopilot.maxTestAttempts = clampAutopilotAttempts(
          a.maxTestAttempts,
          existingAutopilot.maxTestAttempts ?? 3,
        );
      }
      if (a.maxBuildAttempts !== undefined) {
        existingAutopilot.maxBuildAttempts = clampAutopilotAttempts(
          a.maxBuildAttempts,
          existingAutopilot.maxBuildAttempts ?? 2,
        );
      }
      if (a.maxFinalTestAttempts !== undefined) {
        existingAutopilot.maxFinalTestAttempts = clampAutopilotAttempts(
          a.maxFinalTestAttempts,
          existingAutopilot.maxFinalTestAttempts ?? 3,
        );
      }
      if (a.heartbeatIntervalMs !== undefined) {
        existingAutopilot.heartbeatIntervalMs = clampHeartbeatIntervalMs(
          a.heartbeatIntervalMs,
          existingAutopilot.heartbeatIntervalMs ?? 7000,
        );
      }
      if (a.progressStallMs !== undefined) {
        existingAutopilot.progressStallMs = clampProgressStallMs(
          a.progressStallMs,
          existingAutopilot.progressStallMs ?? 90000,
        );
      }
      if (a.heartbeatDeadMs !== undefined) {
        existingAutopilot.heartbeatDeadMs = clampHeartbeatDeadMs(
          a.heartbeatDeadMs,
          existingAutopilot.heartbeatDeadMs ?? 30000,
        );
      }
      if (typeof a.plannerProviderId === 'string') {
        existingAutopilot.plannerProviderId = a.plannerProviderId.trim();
      }
      if (typeof a.plannerModelId === 'string') {
        existingAutopilot.plannerModelId = a.plannerModelId.trim();
      }
      const CONTINUE_SMART_ROUTE_MODES = new Set(['off', 'conservative', 'aggressive']);
      if (typeof a.continueSmartRoute === 'string' && CONTINUE_SMART_ROUTE_MODES.has(a.continueSmartRoute)) {
        existingAutopilot.continueSmartRoute = a.continueSmartRoute;
      }
      if (typeof a.selfHealMaxRounds === 'number') {
        existingAutopilot.selfHealMaxRounds = clampSelfHealRounds(
          a.selfHealMaxRounds,
          existingAutopilot.selfHealMaxRounds ?? 2,
        );
      }
      if (a.autoProvisionInfra !== undefined) {
        existingAutopilot.autoProvisionInfra = parseBool(a.autoProvisionInfra, true);
      }
      if (a.infraProvisionTimeoutMs !== undefined) {
        existingAutopilot.infraProvisionTimeoutMs = clampInfraTimeoutMs(
          a.infraProvisionTimeoutMs,
          existingAutopilot.infraProvisionTimeoutMs ?? 180000,
        );
      }
      if (a.afkAutoRestartStalls !== undefined) {
        existingAutopilot.afkAutoRestartStalls = parseBool(a.afkAutoRestartStalls, true);
      }
      if (a.guardCdOutsideWorktree !== undefined) {
        existingAutopilot.guardCdOutsideWorktree = parseBool(a.guardCdOutsideWorktree, true);
      }
      base.autopilot = existingAutopilot;
    }
  }

  if (p.terminal && typeof p.terminal === 'object') {
    const existingTerminal =
      base.terminal && typeof base.terminal === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.terminal) }
        : {
            open: false,
            heightPx: 240,
            autoOpenOnAgentRun: false,
          };
    const t = /** @type {Record<string, unknown>} */ (p.terminal);
    if (typeof t.open === 'boolean') existingTerminal.open = t.open;
    if (typeof t.heightPx === 'number' && Number.isFinite(t.heightPx)) {
      existingTerminal.heightPx = Math.min(800, Math.max(120, Math.round(t.heightPx)));
    }
    if (typeof t.autoOpenOnAgentRun === 'boolean') {
      existingTerminal.autoOpenOnAgentRun = t.autoOpenOnAgentRun;
    }
    base.terminal = existingTerminal;
  }

  if (p.chat && typeof p.chat === 'object') {
    const existingChat =
      base.chat && typeof base.chat === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.chat) }
        : {
            maxToolTurns: DEFAULT_CHAT_MAX_TOOL_TURNS,
            generationIdleTimeoutMs: DEFAULT_GENERATION_IDLE_TIMEOUT_MS,
            generationMaxDurationMs: DEFAULT_GENERATION_MAX_DURATION_MS,
          };
    let maxToolTurns =
      typeof existingChat.maxToolTurns === 'number' && Number.isFinite(existingChat.maxToolTurns)
        ? Math.round(existingChat.maxToolTurns)
        : DEFAULT_CHAT_MAX_TOOL_TURNS;
    maxToolTurns = Math.min(MAX_CHAT_MAX_TOOL_TURNS, Math.max(1, maxToolTurns));
    let generationIdleTimeoutMs = clampGenerationIdleTimeoutMs(
      existingChat.generationIdleTimeoutMs,
    );
    let generationMaxDurationMs = clampGenerationMaxDurationMs(
      existingChat.generationMaxDurationMs,
    );
    const c = /** @type {Record<string, unknown>} */ (p.chat);
    if (typeof c.maxToolTurns === 'number' && Number.isFinite(c.maxToolTurns)) {
      maxToolTurns = Math.min(MAX_CHAT_MAX_TOOL_TURNS, Math.max(1, Math.round(c.maxToolTurns)));
    }
    if (
      typeof c.generationIdleTimeoutMs === 'number' &&
      Number.isFinite(c.generationIdleTimeoutMs)
    ) {
      generationIdleTimeoutMs = clampGenerationIdleTimeoutMs(c.generationIdleTimeoutMs);
    }
    if (
      typeof c.generationMaxDurationMs === 'number' &&
      Number.isFinite(c.generationMaxDurationMs)
    ) {
      generationMaxDurationMs = clampGenerationMaxDurationMs(c.generationMaxDurationMs);
    }
    base.chat = {
      maxToolTurns,
      generationIdleTimeoutMs,
      generationMaxDurationMs,
    };
  }

  if (p.toolCalls && typeof p.toolCalls === 'object') {
    const existingToolCalls =
      base.toolCalls && typeof base.toolCalls === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.toolCalls) }
        : { useConstrainedDecoding: false };
    const tc = /** @type {Record<string, unknown>} */ (p.toolCalls);
    if (tc.useConstrainedDecoding === true) {
      existingToolCalls.useConstrainedDecoding = true;
    } else if (tc.useConstrainedDecoding === false) {
      existingToolCalls.useConstrainedDecoding = false;
    }
    base.toolCalls = existingToolCalls;
  }

  if (p.workspace && typeof p.workspace === 'object') {
    const existingWorkspace =
      base.workspace && typeof base.workspace === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.workspace) }
        : { path: '' };
    const w = /** @type {Record<string, unknown>} */ (p.workspace);
    if (typeof w.path === 'string' && w.path.trim()) {
      existingWorkspace.path = w.path.trim();
    }
    if (Array.isArray(w.recentPaths)) {
      const trimmed = w.recentPaths
        .filter((p) => typeof p === 'string')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      existingWorkspace.recentPaths = trimmed.slice(0, 10);
    }
    if (w.devServerSettingsByPath && typeof w.devServerSettingsByPath === 'object') {
      const prev =
        existingWorkspace.devServerSettingsByPath &&
        typeof existingWorkspace.devServerSettingsByPath === 'object'
          ? /** @type {Record<string, unknown>} */ (existingWorkspace.devServerSettingsByPath)
          : {};
      existingWorkspace.devServerSettingsByPath = {
        ...prev,
        .../** @type {Record<string, unknown>} */ (w.devServerSettingsByPath),
      };
    }
    if (w.devServerByPath && typeof w.devServerByPath === 'object') {
      const prev =
        existingWorkspace.devServerByPath && typeof existingWorkspace.devServerByPath === 'object'
          ? /** @type {Record<string, unknown>} */ (existingWorkspace.devServerByPath)
          : {};
      existingWorkspace.devServerByPath = {
        ...prev,
        .../** @type {Record<string, unknown>} */ (w.devServerByPath),
      };
    }
    base.workspace = existingWorkspace;
  }

  if (p.filePanel && typeof p.filePanel === 'object') {
    const existingPanel =
      base.filePanel && typeof base.filePanel === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.filePanel) }
        : {
            fileSidebarCollapsed: false,
            viewerOpen: false,
            splitRatio: 0.55,
            expandedDirs: [],
            selectedPath: null,
            treeRoot: '.',
          };
    const fp = /** @type {Record<string, unknown>} */ (p.filePanel);
    if (typeof fp.fileSidebarCollapsed === 'boolean') {
      existingPanel.fileSidebarCollapsed = fp.fileSidebarCollapsed;
    }
    if (typeof fp.viewerOpen === 'boolean') {
      existingPanel.viewerOpen = fp.viewerOpen;
    }
    if (typeof fp.splitRatio === 'number' && Number.isFinite(fp.splitRatio)) {
      existingPanel.splitRatio = Math.min(0.75, Math.max(0.35, fp.splitRatio));
    }
    if (Array.isArray(fp.expandedDirs)) {
      existingPanel.expandedDirs = fp.expandedDirs.filter((d) => typeof d === 'string');
    }
    if (fp.selectedPath === null || typeof fp.selectedPath === 'string') {
      existingPanel.selectedPath = fp.selectedPath;
    }
    if (typeof fp.treeRoot === 'string' && fp.treeRoot.trim()) {
      existingPanel.treeRoot = fp.treeRoot;
    }
    if (fp.rightPaneMode === 'viewer' || fp.rightPaneMode === 'preview' || fp.rightPaneMode === null) {
      existingPanel.rightPaneMode = fp.rightPaneMode;
    }
    if (typeof fp.previewAutoReload === 'boolean') {
      existingPanel.previewAutoReload = fp.previewAutoReload;
    }
    if (fp.previewSource === null) {
      existingPanel.previewSource = null;
    } else if (fp.previewSource && typeof fp.previewSource === 'object') {
      const src = /** @type {Record<string, unknown>} */ (fp.previewSource);
      if (src.kind === 'workspace' && typeof src.path === 'string' && src.path.trim()) {
        existingPanel.previewSource = { kind: 'workspace', path: src.path.trim() };
      } else if (src.kind === 'url' && typeof src.url === 'string' && src.url.trim()) {
        existingPanel.previewSource = { kind: 'url', url: src.url.trim() };
      }
    }
    if (Array.isArray(fp.openViewerTabs)) {
      const seen = new Set();
      const tabs = [];
      for (const entry of fp.openViewerTabs) {
        if (typeof entry !== 'string') continue;
        const trimmed = entry.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
        if (!trimmed || trimmed.startsWith('.minnow/attachments/') || seen.has(trimmed)) continue;
        seen.add(trimmed);
        tabs.push(trimmed);
        if (tabs.length >= 20) break;
      }
      existingPanel.openViewerTabs = tabs;
    }
    if (fp.activeViewerTab === null) {
      existingPanel.activeViewerTab = null;
    } else if (typeof fp.activeViewerTab === 'string' && fp.activeViewerTab.trim()) {
      existingPanel.activeViewerTab = fp.activeViewerTab
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\.\//, '');
    }
    base.filePanel = existingPanel;
  }

  if (p.uiDesigner && typeof p.uiDesigner === 'object') {
    const existingUi =
      base.uiDesigner && typeof base.uiDesigner === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.uiDesigner) }
        : {
            providerId: '',
            modelId: '',
            fallbackToChatModel: true,
          };
    const u = /** @type {Record<string, unknown>} */ (p.uiDesigner);
    if (typeof u.providerId === 'string') existingUi.providerId = u.providerId;
    if (typeof u.modelId === 'string') existingUi.modelId = u.modelId;
    if (typeof u.fallbackToChatModel === 'boolean') {
      existingUi.fallbackToChatModel = u.fallbackToChatModel;
    }
    base.uiDesigner = existingUi;
  }

  if (p.toolSecurity && typeof p.toolSecurity === 'object') {
    const existingTs =
      base.toolSecurity && typeof base.toolSecurity === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.toolSecurity) }
        : { filesystemAccess: 'workspace' };
    const ts = /** @type {Record<string, unknown>} */ (p.toolSecurity);
    if (ts.filesystemAccess === 'full' || ts.filesystemAccess === 'workspace') {
      existingTs.filesystemAccess = ts.filesystemAccess;
    }
    base.toolSecurity = existingTs;
  }

  if (p.editorAiCompletion && typeof p.editorAiCompletion === 'object') {
    const existing =
      base.editorAiCompletion && typeof base.editorAiCompletion === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.editorAiCompletion) }
        : {
            enabled: false,
            debounceMs: 450,
            maxPrefixLines: 80,
            maxSuffixLines: 40,
            maxPrefixChars: 6000,
            maxSuffixChars: 2000,
            temperature: 0.3,
            maxTokens: 128,
            useChatModel: true,
            providerId: '',
            modelId: '',
          };
    const e = /** @type {Record<string, unknown>} */ (p.editorAiCompletion);
    if (typeof e.enabled === 'boolean') existing.enabled = e.enabled;
    if (typeof e.debounceMs === 'number' && Number.isFinite(e.debounceMs)) {
      existing.debounceMs = Math.min(2000, Math.max(200, Math.round(e.debounceMs)));
    }
    if (typeof e.maxPrefixLines === 'number' && Number.isFinite(e.maxPrefixLines)) {
      existing.maxPrefixLines = Math.min(200, Math.max(10, Math.round(e.maxPrefixLines)));
    }
    if (typeof e.maxSuffixLines === 'number' && Number.isFinite(e.maxSuffixLines)) {
      existing.maxSuffixLines = Math.min(100, Math.max(0, Math.round(e.maxSuffixLines)));
    }
    if (typeof e.maxPrefixChars === 'number' && Number.isFinite(e.maxPrefixChars)) {
      existing.maxPrefixChars = Math.min(20_000, Math.max(500, Math.round(e.maxPrefixChars)));
    }
    if (typeof e.maxSuffixChars === 'number' && Number.isFinite(e.maxSuffixChars)) {
      existing.maxSuffixChars = Math.min(10_000, Math.max(0, Math.round(e.maxSuffixChars)));
    }
    if (typeof e.temperature === 'number' && Number.isFinite(e.temperature)) {
      existing.temperature = Math.min(1, Math.max(0, e.temperature));
    }
    if (typeof e.maxTokens === 'number' && Number.isFinite(e.maxTokens)) {
      existing.maxTokens = Math.min(512, Math.max(16, Math.round(e.maxTokens)));
    }
    if (typeof e.useChatModel === 'boolean') existing.useChatModel = e.useChatModel;
    if (typeof e.providerId === 'string') existing.providerId = e.providerId;
    if (typeof e.modelId === 'string') existing.modelId = e.modelId;
    base.editorAiCompletion = existing;
  }

  if (p.editorIntentMode && typeof p.editorIntentMode === 'object') {
    const existing =
      base.editorIntentMode && typeof base.editorIntentMode === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.editorIntentMode) }
        : {
            enabledByDefault: false,
            autoRecheckDefault: false,
            debounceMs: 450,
            contextWindow: 5,
            recheckDelayMs: 600,
            maxRecheckPasses: 8,
          };
    const e = /** @type {Record<string, unknown>} */ (p.editorIntentMode);
    if (typeof e.enabledByDefault === 'boolean') existing.enabledByDefault = e.enabledByDefault;
    if (typeof e.autoRecheckDefault === 'boolean') {
      existing.autoRecheckDefault = e.autoRecheckDefault;
    }
    if (typeof e.debounceMs === 'number' && Number.isFinite(e.debounceMs)) {
      existing.debounceMs = Math.min(2000, Math.max(200, Math.round(e.debounceMs)));
    }
    if (typeof e.contextWindow === 'number' && Number.isFinite(e.contextWindow)) {
      existing.contextWindow = Math.min(20, Math.max(1, Math.round(e.contextWindow)));
    }
    if (typeof e.recheckDelayMs === 'number' && Number.isFinite(e.recheckDelayMs)) {
      existing.recheckDelayMs = Math.min(5000, Math.max(200, Math.round(e.recheckDelayMs)));
    }
    if (typeof e.maxRecheckPasses === 'number' && Number.isFinite(e.maxRecheckPasses)) {
      existing.maxRecheckPasses = Math.min(32, Math.max(1, Math.round(e.maxRecheckPasses)));
    }
    base.editorIntentMode = existing;
  }

  if (p.editorSettings && typeof p.editorSettings === 'object') {
    const existing =
      base.editorSettings && typeof base.editorSettings === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.editorSettings) }
        : {
            fontSize: 13,
            tabSize: 2,
            wordWrap: false,
            renderWhitespace: false,
          };
    const e = /** @type {Record<string, unknown>} */ (p.editorSettings);
    if (typeof e.fontSize === 'number' && Number.isFinite(e.fontSize)) {
      existing.fontSize = Math.min(24, Math.max(10, Math.round(e.fontSize)));
    }
    if (typeof e.tabSize === 'number' && Number.isFinite(e.tabSize)) {
      existing.tabSize = Math.min(8, Math.max(1, Math.round(e.tabSize)));
    }
    if (typeof e.wordWrap === 'boolean') existing.wordWrap = e.wordWrap;
    if (typeof e.renderWhitespace === 'boolean') {
      existing.renderWhitespace = e.renderWhitespace;
    }
    base.editorSettings = existing;
  }

  if (p.server && typeof p.server === 'object') {
    const existingServer =
      base.server && typeof base.server === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.server) }
        : { networkAccess: 'local' };
    const s = /** @type {Record<string, unknown>} */ (p.server);
    if (typeof s.networkAccess === 'string') {
      const mode = s.networkAccess.trim().toLowerCase();
      if (mode === 'local' || mode === 'lan') {
        existingServer.networkAccess = mode;
      }
    }
    base.server = existingServer;
  }

  if (p.browser && typeof p.browser === 'object') {
    const existingBrowser =
      base.browser && typeof base.browser === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.browser) }
        : {
            enabled: true,
            allowNavigate: true,
            allowedOriginPatterns: [
              'http://localhost:*',
              'http://127.0.0.1:*',
              'https://localhost:*',
            ],
          };
    const b = /** @type {Record<string, unknown>} */ (p.browser);
    if (typeof b.enabled === 'boolean') existingBrowser.enabled = b.enabled;
    if (typeof b.allowNavigate === 'boolean') {
      existingBrowser.allowNavigate = b.allowNavigate;
    }
    if (Array.isArray(b.allowedOriginPatterns)) {
      existingBrowser.allowedOriginPatterns = b.allowedOriginPatterns.filter(
        (row) => typeof row === 'string' && row.trim(),
      );
    }
    base.browser = existingBrowser;
  }

  if (p.planning && typeof p.planning === 'object') {
    const existingPlanning =
      base.planning && typeof base.planning === 'object'
        ? { .../** @type {Record<string, unknown>} */ (base.planning) }
        : { granularity: 'medium' };
    const pl = /** @type {Record<string, unknown>} */ (p.planning);
    if (pl.granularity === 'large' || pl.granularity === 'medium' || pl.granularity === 'small') {
      existingPlanning.granularity = pl.granularity;
    }
    base.planning = existingPlanning;
  }

  if (
    p.activePromptProfile === 'full' ||
    p.activePromptProfile === 'lite' ||
    p.activePromptProfile === 'custom'
  ) {
    base.activePromptProfile = p.activePromptProfile;
  }
  if (p.activePromptConfigId === null || typeof p.activePromptConfigId === 'string') {
    base.activePromptConfigId = p.activePromptConfigId;
  }
  if (typeof p.activeInfoPresetId === 'string' && p.activeInfoPresetId.trim()) {
    base.activeInfoPresetId = p.activeInfoPresetId.trim();
  }
  if (p.activeSetupProfileId === null || typeof p.activeSetupProfileId === 'string') {
    base.activeSetupProfileId = p.activeSetupProfileId;
  }
  if (typeof p.workspaceProfileAutoApply === 'boolean') {
    base.workspaceProfileAutoApply = p.workspaceProfileAutoApply;
  }
  if (p.workspaceProfiles && typeof p.workspaceProfiles === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(
      /** @type {Record<string, unknown>} */ (p.workspaceProfiles),
    )) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const normKey = normalizeWorkspacePath(key);
      if (!normKey) continue;
      if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(value.trim())) continue;
      out[normKey] = value.trim();
    }
    base.workspaceProfiles = out;
  }

  if (p.supervisor && typeof p.supervisor === 'object') {
    base.supervisor = mergeSupervisorConfig(
      /** @type {Record<string, unknown>} */ (p.supervisor),
      base.supervisor && typeof base.supervisor === 'object'
        ? /** @type {Record<string, unknown>} */ (base.supervisor)
        : {},
    );
  }

  if (p.memory && typeof p.memory === 'object') {
    base.memory = normalizeMemoryConfig(
      p.memory,
      base.memory && typeof base.memory === 'object'
        ? /** @type {Record<string, unknown>} */ (base.memory)
        : {},
    );
  }

  if (p.synthesis && typeof p.synthesis === 'object') {
    base.synthesis = normalizeSynthesisConfig(
      p.synthesis,
      base.synthesis && typeof base.synthesis === 'object'
        ? /** @type {Record<string, unknown>} */ (base.synthesis)
        : {},
    );
  }

  if (p.fallbackChains !== undefined) {
    base.fallbackChains = normalizeFallbackChainsConfig(
      p.fallbackChains,
      base.fallbackChains && typeof base.fallbackChains === 'object'
        ? /** @type {Record<string, unknown>} */ (base.fallbackChains)
        : {},
    );
  }

  if (p.voice && typeof p.voice === 'object') {
    base.voice = normalizeVoiceConfig(
      p.voice,
      base.voice && typeof base.voice === 'object'
        ? /** @type {Record<string, unknown>} */ (base.voice)
        : {},
    );
  }

  return base;
}

/**
 * Default fallback chain config for new homes and merge fallbacks.
 * @returns {object}
 */
export function defaultFallbackChainsConfig() {
  return {
    enabled: false,
    cooldownSeconds: 60,
    maxChainLength: 4,
    roles: {
      _global: [],
      default: [],
      utility: [],
      research: [],
      vision: [],
    },
  };
}

/**
 * Normalize fallback chain config from config.json meta.
 * @param {unknown} raw
 * @param {Record<string, unknown>} [existing]
 */
export function normalizeFallbackChainsConfig(raw, existing = {}) {
  const base = {
    ...defaultFallbackChainsConfig(),
    ...(existing && typeof existing === 'object' ? existing : {}),
    roles: {
      ...defaultFallbackChainsConfig().roles,
      ...(existing?.roles && typeof existing.roles === 'object'
        ? /** @type {Record<string, unknown>} */ (existing.roles)
        : {}),
    },
  };

  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const patch = /** @type {Record<string, unknown>} */ (raw);
  if (typeof patch.enabled === 'boolean') {
    base.enabled = patch.enabled;
  }
  if (typeof patch.cooldownSeconds === 'number' && Number.isFinite(patch.cooldownSeconds)) {
    base.cooldownSeconds = Math.min(3600, Math.max(10, Math.round(patch.cooldownSeconds)));
  }
  if (typeof patch.maxChainLength === 'number' && Number.isFinite(patch.maxChainLength)) {
    base.maxChainLength = Math.min(8, Math.max(1, Math.round(patch.maxChainLength)));
  }

  if (patch.roles && typeof patch.roles === 'object') {
    const roles = { ...base.roles };
    for (const [role, entries] of Object.entries(
      /** @type {Record<string, unknown>} */ (patch.roles),
    )) {
      if (!Array.isArray(entries)) continue;
      const normalized = [];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const row = /** @type {Record<string, unknown>} */ (entry);
        if (typeof row.providerId !== 'string' || !row.providerId.trim()) continue;
        let providerId;
        try {
          providerId = row.providerId.trim();
        } catch {
          continue;
        }
        normalized.push({
          providerId,
          modelId: typeof row.modelId === 'string' ? row.modelId : '',
        });
        if (normalized.length >= base.maxChainLength) break;
      }
      roles[role] = normalized;
    }
    base.roles = roles;
  }

  return base;
}

const QWEN_CUSTOM_VOICE_06B = 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice';

const TTS_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
]);

const TTS_FORMATS = new Set(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']);

const STT_RESPONSE_FORMATS = new Set(['json', 'text', 'verbose_json', 'srt', 'vtt']);

/** Clamp a numeric config field to [min, max] with fallback. */
function clampVoiceNum(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isQwen06bCustomVoice(modelId) {
  return typeof modelId === 'string' && modelId.includes('0.6B-CustomVoice');
}

/**
 * Default local Whisper settings (GPU-first when CUDA is available).
 * @param {boolean} [cudaAvailable]
 */
function defaultSttLocal(cudaAvailable = false) {
  return {
    modelId: cudaAvailable ? 'openai/whisper-small' : 'openai/whisper-base',
    language: '',
    task: 'transcribe',
    longFormAlgorithm: 'chunked',
    chunkLengthSeconds: 30,
    batchSize: 1,
    returnTimestamps: false,
    timestampGranularity: 'segment',
    maxNewTokens: 448,
    numBeams: 1,
    conditionOnPrevTokens: false,
    compressionRatioThreshold: 1.35,
    temperatureFallback: true,
    temperature: 0,
    logprobThreshold: -1,
    noSpeechThreshold: 0.6,
    device: 'auto',
    computeType: 'auto',
    attnImplementation: 'auto',
    useSafetensors: true,
    lowCpuMemUsage: true,
    torchCompile: false,
    streamingEnabled: true,
  };
}

function defaultSttProvider() {
  return {
    providerId: '',
    model: 'whisper-1',
    language: 'en',
    prompt: '',
    responseFormat: 'json',
    temperature: 0,
  };
}

/**
 * Default local Qwen3-TTS settings (GPU-first when CUDA is available).
 * @param {boolean} [cudaAvailable]
 */
function defaultTtsLocal(cudaAvailable = false) {
  return {
    modelId: QWEN_CUSTOM_VOICE_06B,
    deviceMap: 'auto',
    dtype: cudaAvailable ? 'bfloat16' : 'float32',
    attnImplementation: 'auto',
    tokenizerModelId: 'Qwen/Qwen3-TTS-Tokenizer-12Hz',
    mode: 'custom_voice',
    customVoice: {
      speaker: 'Ryan',
      language: 'Auto',
      instruct: '',
    },
    voiceDesign: {
      language: 'Auto',
      instruct: '',
    },
    voiceClone: {
      refAudioPath: '',
      refText: '',
      xVectorOnlyMode: false,
      language: 'Auto',
      savedPromptId: '',
    },
    generation: {
      maxNewTokens: 2048,
      topP: 1,
      topK: 50,
      temperature: 0.9,
      repetitionPenalty: 1,
    },
    streaming: defaultTtsLocalStreaming(),
  };
}

/** Default PCM streaming tuning for local Qwen3-TTS (distinct from `tts.streaming` enable flag). */
function defaultTtsLocalStreaming() {
  return {
    emitEveryFrames: 8,
    decodeWindowFrames: 80,
    firstChunkEmitEvery: 5,
    firstChunkDecodeWindow: 48,
    overlapSamples: 512,
    repetitionPenalty: 1.05,
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} base
 */
function normalizeTtsLocalStreaming(raw, base) {
  const out = { ...base };
  out.emitEveryFrames = clampVoiceNum(raw.emitEveryFrames, 1, 32, out.emitEveryFrames);
  out.decodeWindowFrames = clampVoiceNum(raw.decodeWindowFrames, 16, 256, out.decodeWindowFrames);
  out.firstChunkEmitEvery = clampVoiceNum(raw.firstChunkEmitEvery, 1, 32, out.firstChunkEmitEvery);
  out.firstChunkDecodeWindow = clampVoiceNum(
    raw.firstChunkDecodeWindow,
    16,
    256,
    out.firstChunkDecodeWindow,
  );
  out.overlapSamples = clampVoiceNum(raw.overlapSamples, 0, 4096, out.overlapSamples);
  out.repetitionPenalty = clampVoiceNum(raw.repetitionPenalty, 0.5, 2, out.repetitionPenalty);
  return out;
}

function defaultTtsProvider() {
  return {
    providerId: '',
    model: 'tts-1',
    voice: 'alloy',
    speed: 1,
    format: 'mp3',
  };
}

function defaultTtsBrowser() {
  return {
    voiceUri: '',
    rate: 1,
    pitch: 1,
    volume: 1,
  };
}

function defaultVoiceAudio() {
  return {
    inputDeviceId: '',
    outputDeviceId: '',
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

/**
 * Default voice I/O config for new homes and merge fallbacks.
 * @param {boolean} [cudaAvailable] When true, prefer whisper-small and bfloat16 TTS.
 * @returns {object}
 */
export function defaultVoiceConfig(cudaAvailable = false) {
  const sttLocal = defaultSttLocal(cudaAvailable);
  const ttsLocal = defaultTtsLocal(cudaAvailable);
  const sttProvider = defaultSttProvider();
  const ttsProvider = defaultTtsProvider();
  return {
    audio: defaultVoiceAudio(),
    stt: {
      enabled: true,
      backend: 'local',
      local: sttLocal,
      provider: sttProvider,
      providerId: '',
      model: sttLocal.modelId,
      language: sttLocal.language,
    },
    tts: {
      enabled: true,
      backend: 'local',
      streaming: true,
      local: ttsLocal,
      provider: ttsProvider,
      browser: defaultTtsBrowser(),
      providerId: '',
      model: ttsLocal.modelId,
      voice: ttsLocal.customVoice.speaker,
      speed: 1,
      format: 'wav',
    },
    limits: {
      maxAudioBytes: 25 * 1024 * 1024,
      maxDurationSeconds: 300,
      silenceTimeoutSeconds: 2.5,
    },
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} base
 */
function normalizeSttLocal(raw, base) {
  const out = { ...base };
  if (typeof raw.modelId === 'string' && raw.modelId.trim()) out.modelId = raw.modelId.trim();
  if (typeof raw.language === 'string') out.language = raw.language.trim();
  if (raw.task === 'transcribe' || raw.task === 'translate') out.task = raw.task;
  if (raw.longFormAlgorithm === 'sequential' || raw.longFormAlgorithm === 'chunked') {
    out.longFormAlgorithm = raw.longFormAlgorithm;
  }
  out.chunkLengthSeconds = clampVoiceNum(raw.chunkLengthSeconds, 10, 30, out.chunkLengthSeconds);
  out.batchSize = clampVoiceNum(raw.batchSize, 1, 16, out.batchSize);
  if (typeof raw.returnTimestamps === 'boolean') out.returnTimestamps = raw.returnTimestamps;
  if (raw.timestampGranularity === 'segment' || raw.timestampGranularity === 'word') {
    out.timestampGranularity = raw.timestampGranularity;
  }
  out.maxNewTokens = clampVoiceNum(raw.maxNewTokens, 1, 448, out.maxNewTokens);
  out.numBeams = clampVoiceNum(raw.numBeams, 1, 5, out.numBeams);
  if (typeof raw.conditionOnPrevTokens === 'boolean') {
    out.conditionOnPrevTokens = raw.conditionOnPrevTokens;
  }
  out.compressionRatioThreshold = clampVoiceNum(
    raw.compressionRatioThreshold,
    0.5,
    2,
    out.compressionRatioThreshold,
  );
  if (typeof raw.temperatureFallback === 'boolean') out.temperatureFallback = raw.temperatureFallback;
  out.temperature = clampVoiceNum(raw.temperature, 0, 1, out.temperature);
  out.logprobThreshold = clampVoiceNum(raw.logprobThreshold, -2, 0, out.logprobThreshold);
  out.noSpeechThreshold = clampVoiceNum(raw.noSpeechThreshold, 0, 1, out.noSpeechThreshold);
  if (raw.device === 'auto' || raw.device === 'cpu' || raw.device === 'cuda') out.device = raw.device;
  if (
    raw.computeType === 'auto' ||
    raw.computeType === 'float16' ||
    raw.computeType === 'bfloat16' ||
    raw.computeType === 'float32'
  ) {
    out.computeType = raw.computeType;
  }
  if (
    raw.attnImplementation === 'auto' ||
    raw.attnImplementation === 'sdpa' ||
    raw.attnImplementation === 'flash_attention_2'
  ) {
    out.attnImplementation = raw.attnImplementation;
  }
  if (typeof raw.useSafetensors === 'boolean') out.useSafetensors = raw.useSafetensors;
  if (typeof raw.lowCpuMemUsage === 'boolean') out.lowCpuMemUsage = raw.lowCpuMemUsage;
  if (typeof raw.torchCompile === 'boolean') out.torchCompile = raw.torchCompile;
  if (typeof raw.streamingEnabled === 'boolean') out.streamingEnabled = raw.streamingEnabled;
  return out;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} base
 */
function normalizeSttProvider(raw, base) {
  const out = { ...base };
  if (typeof raw.providerId === 'string') out.providerId = raw.providerId.trim();
  if (typeof raw.model === 'string' && raw.model.trim()) out.model = raw.model.trim();
  if (typeof raw.language === 'string') out.language = raw.language.trim();
  if (typeof raw.prompt === 'string') out.prompt = raw.prompt;
  if (typeof raw.responseFormat === 'string' && STT_RESPONSE_FORMATS.has(raw.responseFormat)) {
    out.responseFormat = raw.responseFormat;
  }
  out.temperature = clampVoiceNum(raw.temperature, 0, 1, out.temperature);
  return out;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} base
 */
function normalizeTtsLocal(raw, base) {
  const out = { ...base };
  if (typeof raw.modelId === 'string' && raw.modelId.trim()) out.modelId = raw.modelId.trim();
  if (raw.deviceMap === 'auto' || raw.deviceMap === 'cpu' || raw.deviceMap === 'cuda:0') {
    out.deviceMap = raw.deviceMap;
  }
  if (
    raw.dtype === 'auto' ||
    raw.dtype === 'bfloat16' ||
    raw.dtype === 'float16' ||
    raw.dtype === 'float32'
  ) {
    out.dtype = raw.dtype;
  }
  if (
    raw.attnImplementation === 'auto' ||
    raw.attnImplementation === 'flash_attention_2' ||
    raw.attnImplementation === 'sdpa' ||
    raw.attnImplementation === 'eager'
  ) {
    out.attnImplementation = raw.attnImplementation;
  }
  if (typeof raw.tokenizerModelId === 'string' && raw.tokenizerModelId.trim()) {
    out.tokenizerModelId = raw.tokenizerModelId.trim();
  }
  if (raw.mode === 'custom_voice' || raw.mode === 'voice_design' || raw.mode === 'voice_clone') {
    out.mode = raw.mode;
  }
  if (raw.customVoice && typeof raw.customVoice === 'object') {
    const cv = /** @type {Record<string, unknown>} */ (raw.customVoice);
    if (typeof cv.speaker === 'string' && cv.speaker.trim()) {
      out.customVoice.speaker = cv.speaker.trim();
    }
    if (typeof cv.language === 'string') out.customVoice.language = cv.language.trim();
    if (typeof cv.instruct === 'string') out.customVoice.instruct = cv.instruct;
  }
  if (raw.voiceDesign && typeof raw.voiceDesign === 'object') {
    const vd = /** @type {Record<string, unknown>} */ (raw.voiceDesign);
    if (typeof vd.language === 'string') out.voiceDesign.language = vd.language.trim();
    if (typeof vd.instruct === 'string') out.voiceDesign.instruct = vd.instruct;
  }
  if (raw.voiceClone && typeof raw.voiceClone === 'object') {
    const vc = /** @type {Record<string, unknown>} */ (raw.voiceClone);
    if (typeof vc.refAudioPath === 'string') out.voiceClone.refAudioPath = vc.refAudioPath.trim();
    if (typeof vc.refText === 'string') out.voiceClone.refText = vc.refText;
    if (typeof vc.xVectorOnlyMode === 'boolean') out.voiceClone.xVectorOnlyMode = vc.xVectorOnlyMode;
    if (typeof vc.language === 'string') out.voiceClone.language = vc.language.trim();
    if (typeof vc.savedPromptId === 'string') {
      out.voiceClone.savedPromptId = vc.savedPromptId.trim();
    }
  }
  if (raw.generation && typeof raw.generation === 'object') {
    const gen = /** @type {Record<string, unknown>} */ (raw.generation);
    out.generation.maxNewTokens = clampVoiceNum(
      gen.maxNewTokens,
      256,
      4096,
      out.generation.maxNewTokens,
    );
    out.generation.topP = clampVoiceNum(gen.topP, 0, 1, out.generation.topP);
    out.generation.topK = clampVoiceNum(gen.topK, 0, 100, out.generation.topK);
    out.generation.temperature = clampVoiceNum(gen.temperature, 0, 2, out.generation.temperature);
    out.generation.repetitionPenalty = clampVoiceNum(
      gen.repetitionPenalty,
      0,
      2,
      out.generation.repetitionPenalty,
    );
  }
  if (raw.streaming && typeof raw.streaming === 'object') {
    out.streaming = normalizeTtsLocalStreaming(
      /** @type {Record<string, unknown>} */ (raw.streaming),
      out.streaming ?? defaultTtsLocalStreaming(),
    );
  } else if (!out.streaming) {
    out.streaming = defaultTtsLocalStreaming();
  }
  if (isQwen06bCustomVoice(out.modelId)) {
    out.customVoice.instruct = '';
  }
  return out;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} base
 */
function normalizeTtsProvider(raw, base) {
  const out = { ...base };
  if (typeof raw.providerId === 'string') out.providerId = raw.providerId.trim();
  if (typeof raw.model === 'string' && raw.model.trim()) out.model = raw.model.trim();
  if (typeof raw.voice === 'string' && raw.voice.trim()) {
    const voice = raw.voice.trim().toLowerCase();
    out.voice = TTS_VOICES.has(voice) ? voice : out.voice;
  }
  out.speed = clampVoiceNum(raw.speed, 0.25, 4, out.speed);
  if (typeof raw.format === 'string' && TTS_FORMATS.has(raw.format.trim().toLowerCase())) {
    out.format = raw.format.trim().toLowerCase();
  }
  return out;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} base
 */
function normalizeTtsBrowser(raw, base) {
  const out = { ...base };
  if (typeof raw.voiceUri === 'string') out.voiceUri = raw.voiceUri.trim();
  out.rate = clampVoiceNum(raw.rate, 0.25, 4, out.rate);
  out.pitch = clampVoiceNum(raw.pitch, 0, 2, out.pitch);
  out.volume = clampVoiceNum(raw.volume, 0, 1, out.volume);
  return out;
}

/** Sync legacy flat STT/TTS fields for provider middleware compatibility. */
function syncLegacyVoiceFields(stt, tts) {
  if (stt.backend === 'provider') {
    stt.providerId = stt.provider.providerId;
    stt.model = stt.provider.model;
    stt.language = stt.provider.language;
  } else {
    stt.providerId = '';
    stt.model = stt.local.modelId;
    stt.language = stt.local.language;
  }

  if (tts.backend === 'provider') {
    tts.providerId = tts.provider.providerId;
    tts.model = tts.provider.model;
    tts.voice = tts.provider.voice;
    tts.speed = tts.provider.speed;
    tts.format = tts.provider.format;
  } else if (tts.backend === 'browser') {
    tts.providerId = 'browser';
    tts.model = '';
    tts.voice = tts.browser.voiceUri;
    tts.speed = tts.browser.rate;
    tts.format = 'wav';
  } else {
    tts.providerId = '';
    tts.model = tts.local.modelId;
    tts.voice = tts.local.customVoice.speaker;
    tts.speed = 1;
    tts.format = 'wav';
  }
}

/**
 * Normalize voice STT/TTS settings persisted in config.json.
 * @param {unknown} raw
 * @param {Record<string, unknown>} [existing]
 * @param {{ cudaAvailable?: boolean, installedManifest?: { stt?: unknown[], tts?: unknown[] } }} [options]
 */
export function normalizeVoiceConfig(raw, existing = {}, options = {}) {
  const cudaAvailable = options.cudaAvailable === true;
  const defaults = defaultVoiceConfig(cudaAvailable);
  const base = {
    audio: {
      ...defaults.audio,
      ...(existing.audio && typeof existing.audio === 'object'
        ? /** @type {Record<string, unknown>} */ (existing.audio)
        : {}),
    },
    stt: {
      ...defaults.stt,
      local: normalizeSttLocal(
        existing.stt &&
          typeof existing.stt === 'object' &&
          existing.stt.local &&
          typeof existing.stt.local === 'object'
          ? /** @type {Record<string, unknown>} */ (existing.stt.local)
          : {},
        defaults.stt.local,
      ),
      provider: normalizeSttProvider(
        existing.stt &&
          typeof existing.stt === 'object' &&
          existing.stt.provider &&
          typeof existing.stt.provider === 'object'
          ? /** @type {Record<string, unknown>} */ (existing.stt.provider)
          : {},
        defaults.stt.provider,
      ),
    },
    tts: {
      ...defaults.tts,
      local: normalizeTtsLocal(
        existing.tts &&
          typeof existing.tts === 'object' &&
          existing.tts.local &&
          typeof existing.tts.local === 'object'
          ? /** @type {Record<string, unknown>} */ (existing.tts.local)
          : {},
        defaults.tts.local,
      ),
      provider: normalizeTtsProvider(
        existing.tts &&
          typeof existing.tts === 'object' &&
          existing.tts.provider &&
          typeof existing.tts.provider === 'object'
          ? /** @type {Record<string, unknown>} */ (existing.tts.provider)
          : {},
        defaults.tts.provider,
      ),
      browser: normalizeTtsBrowser(
        existing.tts &&
          typeof existing.tts === 'object' &&
          existing.tts.browser &&
          typeof existing.tts.browser === 'object'
          ? /** @type {Record<string, unknown>} */ (existing.tts.browser)
          : {},
        defaults.tts.browser,
      ),
    },
    limits: {
      ...defaults.limits,
      ...(existing.limits && typeof existing.limits === 'object'
        ? /** @type {Record<string, unknown>} */ (existing.limits)
        : {}),
    },
  };

  if (existing.stt && typeof existing.stt === 'object') {
    const estt = /** @type {Record<string, unknown>} */ (existing.stt);
    if (typeof estt.enabled === 'boolean') base.stt.enabled = estt.enabled;
    if (estt.backend === 'local' || estt.backend === 'provider') base.stt.backend = estt.backend;
  }
  if (existing.tts && typeof existing.tts === 'object') {
    const etts = /** @type {Record<string, unknown>} */ (existing.tts);
    if (typeof etts.enabled === 'boolean') base.tts.enabled = etts.enabled;
    if (typeof etts.streaming === 'boolean') base.tts.streaming = etts.streaming;
    if (etts.backend === 'local' || etts.backend === 'provider' || etts.backend === 'browser') {
      base.tts.backend = etts.backend;
    }
  }

  if (!raw || typeof raw !== 'object') {
    syncLegacyVoiceFields(base.stt, base.tts);
    return base;
  }
  const row = /** @type {Record<string, unknown>} */ (raw);

  if (row.audio && typeof row.audio === 'object') {
    const audio = /** @type {Record<string, unknown>} */ (row.audio);
    if (typeof audio.inputDeviceId === 'string') {
      base.audio.inputDeviceId = audio.inputDeviceId.trim();
    }
    if (typeof audio.outputDeviceId === 'string') {
      base.audio.outputDeviceId = audio.outputDeviceId.trim();
    }
    if (typeof audio.echoCancellation === 'boolean') {
      base.audio.echoCancellation = audio.echoCancellation;
    }
    if (typeof audio.noiseSuppression === 'boolean') {
      base.audio.noiseSuppression = audio.noiseSuppression;
    }
    if (typeof audio.autoGainControl === 'boolean') {
      base.audio.autoGainControl = audio.autoGainControl;
    }
  }

  if (row.stt && typeof row.stt === 'object') {
    const stt = /** @type {Record<string, unknown>} */ (row.stt);
    if (typeof stt.enabled === 'boolean') base.stt.enabled = stt.enabled;
    if (stt.local && typeof stt.local === 'object') {
      base.stt.local = normalizeSttLocal(
        /** @type {Record<string, unknown>} */ (stt.local),
        base.stt.local,
      );
    }
    if (stt.provider && typeof stt.provider === 'object') {
      base.stt.provider = normalizeSttProvider(
        /** @type {Record<string, unknown>} */ (stt.provider),
        base.stt.provider,
      );
    }
    if (typeof stt.providerId === 'string' && stt.providerId.trim()) {
      base.stt.provider.providerId = stt.providerId.trim();
    }
    if (typeof stt.model === 'string' && stt.model.trim() && !stt.local) {
      base.stt.provider.model = stt.model.trim();
    }
    if (typeof stt.language === 'string' && stt.language.trim() && !stt.local) {
      base.stt.provider.language = stt.language.trim();
    }
    if (stt.backend === 'local' || stt.backend === 'provider') {
      base.stt.backend = stt.backend;
    } else if (base.stt.provider.providerId) {
      base.stt.backend = 'provider';
    } else {
      base.stt.backend = 'local';
    }
  }

  if (row.tts && typeof row.tts === 'object') {
    const tts = /** @type {Record<string, unknown>} */ (row.tts);
    if (typeof tts.enabled === 'boolean') base.tts.enabled = tts.enabled;
    if (typeof tts.streaming === 'boolean') base.tts.streaming = tts.streaming;
    if (tts.local && typeof tts.local === 'object') {
      base.tts.local = normalizeTtsLocal(
        /** @type {Record<string, unknown>} */ (tts.local),
        base.tts.local,
      );
    }
    if (tts.provider && typeof tts.provider === 'object') {
      base.tts.provider = normalizeTtsProvider(
        /** @type {Record<string, unknown>} */ (tts.provider),
        base.tts.provider,
      );
    }
    if (tts.browser && typeof tts.browser === 'object') {
      base.tts.browser = normalizeTtsBrowser(
        /** @type {Record<string, unknown>} */ (tts.browser),
        base.tts.browser,
      );
    }
    if (typeof tts.providerId === 'string' && tts.providerId.trim()) {
      const pid = tts.providerId.trim();
      if (pid === 'browser') {
        base.tts.backend = 'browser';
      } else {
        base.tts.provider.providerId = pid;
      }
    }
    if (typeof tts.model === 'string' && tts.model.trim() && !tts.local) {
      base.tts.provider.model = tts.model.trim();
    }
    if (typeof tts.voice === 'string' && tts.voice.trim() && !tts.local) {
      const voice = tts.voice.trim().toLowerCase();
      base.tts.provider.voice = TTS_VOICES.has(voice) ? voice : base.tts.provider.voice;
    }
    if (typeof tts.speed === 'number' && Number.isFinite(tts.speed) && !tts.provider) {
      base.tts.provider.speed = clampVoiceNum(tts.speed, 0.25, 4, base.tts.provider.speed);
    }
    if (typeof tts.format === 'string' && tts.format.trim() && !tts.provider) {
      const format = tts.format.trim().toLowerCase();
      if (TTS_FORMATS.has(format)) base.tts.provider.format = format;
    }
    if (tts.backend === 'local' || tts.backend === 'provider' || tts.backend === 'browser') {
      base.tts.backend = tts.backend;
    } else if (base.tts.provider.providerId) {
      base.tts.backend = 'provider';
    } else if (tts.providerId === 'browser') {
      base.tts.backend = 'browser';
    } else {
      base.tts.backend = 'local';
    }
  }

  if (row.limits && typeof row.limits === 'object') {
    const limits = /** @type {Record<string, unknown>} */ (row.limits);
    if (typeof limits.maxAudioBytes === 'number' && Number.isFinite(limits.maxAudioBytes)) {
      base.limits.maxAudioBytes = Math.max(1024, Math.round(limits.maxAudioBytes));
    }
    if (
      typeof limits.maxDurationSeconds === 'number' &&
      Number.isFinite(limits.maxDurationSeconds)
    ) {
      base.limits.maxDurationSeconds = Math.max(1, Math.round(limits.maxDurationSeconds));
    }
    if (
      typeof limits.silenceTimeoutSeconds === 'number' &&
      Number.isFinite(limits.silenceTimeoutSeconds)
    ) {
      base.limits.silenceTimeoutSeconds = Math.max(
        0,
        Math.min(30, limits.silenceTimeoutSeconds),
      );
    }
  }

  syncLegacyVoiceFields(base.stt, base.tts);

  const manifest = options.installedManifest;
  if (manifest && typeof manifest === 'object') {
    const sttRows = Array.isArray(manifest.stt) ? manifest.stt : [];
    const ttsRows = Array.isArray(manifest.tts) ? manifest.tts : [];
    const hasLocalStt = sttRows.some(
      (row) =>
        row &&
        typeof row === 'object' &&
        /** @type {{ mode?: string }} */ (row).mode !== 'tokenizer',
    );
    const hasLocalTts = ttsRows.some(
      (row) =>
        row &&
        typeof row === 'object' &&
        /** @type {{ mode?: string }} */ (row).mode !== 'tokenizer',
    );
    if (
      base.stt.backend === 'local' &&
      !hasLocalStt &&
      typeof base.stt.provider?.providerId === 'string' &&
      base.stt.provider.providerId.trim()
    ) {
      base.stt.backend = 'provider';
    }
    if (
      base.tts.backend === 'local' &&
      !hasLocalTts &&
      typeof base.tts.provider?.providerId === 'string' &&
      base.tts.provider.providerId.trim()
    ) {
      base.tts.backend = 'provider';
    }
    syncLegacyVoiceFields(base.stt, base.tts);
  }

  return base;
}

/**
 * Normalize memory config including semantic embeddings subsection.
 * @param {unknown} raw
 * @param {Record<string, unknown>} [existing]
 */
export function normalizeMemoryConfig(raw, existing = {}) {
  const base = {
    enabled: true,
    maxEntries: 500,
    maxInjectCharsFull: 4000,
    maxInjectCharsLite: 800,
    retrieveLimit: 20,
    defaultTags: [],
    embeddings: {
      enabled: false,
      backend: 'local',
      modelId: 'Xenova/all-MiniLM-L6-v2',
      providerId: '',
      blendWeight: 0.5,
      queryTimeoutMs: 3000,
      reindexNeeded: false,
    },
    ...existing,
  };

  if (!raw || typeof raw !== 'object') return base;
  const row = /** @type {Record<string, unknown>} */ (raw);

  if (typeof row.enabled === 'boolean') base.enabled = row.enabled;
  if (typeof row.maxEntries === 'number' && Number.isFinite(row.maxEntries)) {
    base.maxEntries = Math.min(5000, Math.max(1, Math.floor(row.maxEntries)));
  }
  if (typeof row.maxInjectCharsFull === 'number' && Number.isFinite(row.maxInjectCharsFull)) {
    base.maxInjectCharsFull = Math.min(32_000, Math.max(200, Math.floor(row.maxInjectCharsFull)));
  }
  if (typeof row.maxInjectCharsLite === 'number' && Number.isFinite(row.maxInjectCharsLite)) {
    base.maxInjectCharsLite = Math.min(8000, Math.max(100, Math.floor(row.maxInjectCharsLite)));
  }
  if (typeof row.retrieveLimit === 'number' && Number.isFinite(row.retrieveLimit)) {
    base.retrieveLimit = Math.min(100, Math.max(1, Math.floor(row.retrieveLimit)));
  }
  if (Array.isArray(row.defaultTags)) {
    base.defaultTags = row.defaultTags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.slice(0, 64));
  }

  const existingEmb =
    base.embeddings && typeof base.embeddings === 'object'
      ? { .../** @type {Record<string, unknown>} */ (base.embeddings) }
      : {};
  const embRaw =
    row.embeddings && typeof row.embeddings === 'object'
      ? /** @type {Record<string, unknown>} */ (row.embeddings)
      : {};

  if (typeof embRaw.enabled === 'boolean') existingEmb.enabled = embRaw.enabled;
  if (embRaw.backend === 'local' || embRaw.backend === 'provider') {
    existingEmb.backend = embRaw.backend;
  }
  if (typeof embRaw.modelId === 'string') existingEmb.modelId = embRaw.modelId.slice(0, 200);
  if (typeof embRaw.providerId === 'string') existingEmb.providerId = embRaw.providerId.slice(0, 64);
  if (typeof embRaw.blendWeight === 'number' && Number.isFinite(embRaw.blendWeight)) {
    existingEmb.blendWeight = Math.min(1, Math.max(0, embRaw.blendWeight));
  }
  if (typeof embRaw.queryTimeoutMs === 'number' && Number.isFinite(embRaw.queryTimeoutMs)) {
    existingEmb.queryTimeoutMs = Math.min(60_000, Math.max(500, Math.floor(embRaw.queryTimeoutMs)));
  }
  if (typeof embRaw.reindexNeeded === 'boolean') existingEmb.reindexNeeded = embRaw.reindexNeeded;

  const prevEmb =
    existing.embeddings && typeof existing.embeddings === 'object'
      ? /** @type {Record<string, unknown>} */ (existing.embeddings)
      : {};

  if (
    (typeof embRaw.backend === 'string' && embRaw.backend !== prevEmb.backend) ||
    (typeof embRaw.modelId === 'string' && embRaw.modelId !== prevEmb.modelId) ||
    (typeof embRaw.providerId === 'string' && embRaw.providerId !== prevEmb.providerId)
  ) {
    existingEmb.reindexNeeded = true;
  }

  base.embeddings = existingEmb;
  return base;
}

/**
 * Normalize synthesis config for memory/skill auto-learning proposals.
 * @param {unknown} raw
 * @param {Record<string, unknown>} [existing]
 */
export function normalizeSynthesisConfig(raw, existing = {}) {
  const base = {
    enabled: true,
    requireConfirmation: true,
    confidenceThreshold: 0.6,
    maxProposalsPerTurn: 3,
    throttleMessagePairs: 4,
    skillMinRounds: 2,
    skillMinToolCalls: 2,
    utilityProviderId: '',
    utilityModelId: '',
    maxPendingProposals: 100,
    rejectedRetentionDays: 30,
    ...existing,
  };

  if (!raw || typeof raw !== 'object') return base;
  const row = /** @type {Record<string, unknown>} */ (raw);

  if (typeof row.enabled === 'boolean') base.enabled = row.enabled;
  if (typeof row.requireConfirmation === 'boolean') {
    base.requireConfirmation = row.requireConfirmation;
  }
  if (typeof row.confidenceThreshold === 'number' && Number.isFinite(row.confidenceThreshold)) {
    base.confidenceThreshold = Math.min(1, Math.max(0, row.confidenceThreshold));
  }
  if (typeof row.maxProposalsPerTurn === 'number' && Number.isFinite(row.maxProposalsPerTurn)) {
    base.maxProposalsPerTurn = Math.min(10, Math.max(1, Math.floor(row.maxProposalsPerTurn)));
  }
  if (typeof row.throttleMessagePairs === 'number' && Number.isFinite(row.throttleMessagePairs)) {
    base.throttleMessagePairs = Math.min(20, Math.max(1, Math.floor(row.throttleMessagePairs)));
  }
  if (typeof row.skillMinRounds === 'number' && Number.isFinite(row.skillMinRounds)) {
    base.skillMinRounds = Math.min(10, Math.max(1, Math.floor(row.skillMinRounds)));
  }
  if (typeof row.skillMinToolCalls === 'number' && Number.isFinite(row.skillMinToolCalls)) {
    base.skillMinToolCalls = Math.min(20, Math.max(1, Math.floor(row.skillMinToolCalls)));
  }
  if (typeof row.utilityProviderId === 'string') {
    base.utilityProviderId = row.utilityProviderId.trim();
  }
  if (typeof row.utilityModelId === 'string') {
    base.utilityModelId = row.utilityModelId.trim();
  }
  if (typeof row.maxPendingProposals === 'number' && Number.isFinite(row.maxPendingProposals)) {
    base.maxPendingProposals = Math.min(500, Math.max(10, Math.floor(row.maxPendingProposals)));
  }
  if (typeof row.rejectedRetentionDays === 'number' && Number.isFinite(row.rejectedRetentionDays)) {
    base.rejectedRetentionDays = Math.min(365, Math.max(1, Math.floor(row.rejectedRetentionDays)));
  }

  return base;
}

const DEFAULT_SUB_AGENTS = {
  version: 1,
  enabled: true,
  globalMaxConcurrent: 3,
  defaultTimeoutMs: 300000,
  types: {},
};

/**
 * Normalize sub-agents.json user overrides (warn on unknown tool ids).
 * @param {unknown} body
 * @returns {{ config: object, warnings: string[] }}
 */
export function normalizeSubAgentsConfig(body) {
  const warnings = [];
  const base =
    body && typeof body === 'object'
      ? { ...DEFAULT_SUB_AGENTS, .../** @type {Record<string, unknown>} */ (body) }
      : { ...DEFAULT_SUB_AGENTS };

  if (typeof base.enabled !== 'boolean') base.enabled = true;
  if (typeof base.globalMaxConcurrent !== 'number' || base.globalMaxConcurrent < 1) {
    base.globalMaxConcurrent = 3;
  }
  if (typeof base.defaultTimeoutMs !== 'number' || base.defaultTimeoutMs < 1000) {
    base.defaultTimeoutMs = 300000;
  }
  if (typeof base.checkInNudgeMs === 'number' && Number.isFinite(base.checkInNudgeMs)) {
    const rounded = Math.round(base.checkInNudgeMs);
    base.checkInNudgeMs = rounded <= 0 ? 0 : Math.min(1_800_000, Math.max(10_000, rounded));
  } else {
    base.checkInNudgeMs = 120_000;
  }
  let maxToolTurns = DEFAULT_SUB_AGENT_MAX_TOOL_TURNS;
  if (typeof base.maxToolTurns === 'number' && Number.isFinite(base.maxToolTurns)) {
    maxToolTurns = Math.min(MAX_CHAT_MAX_TOOL_TURNS, Math.max(1, Math.round(base.maxToolTurns)));
  } else if (
    typeof base.defaultMaxToolTurns === 'number' &&
    Number.isFinite(base.defaultMaxToolTurns)
  ) {
    maxToolTurns = Math.min(MAX_CHAT_MAX_TOOL_TURNS, Math.max(1, Math.round(base.defaultMaxToolTurns)));
  }
  base.maxToolTurns = maxToolTurns;
  delete base.defaultMaxToolTurns;
  if (typeof base.version !== 'number') base.version = 1;

  if (!base.types || typeof base.types !== 'object') {
    base.types = {};
  }

  const types = /** @type {Record<string, unknown>} */ (base.types);
  for (const [typeId, rawType] of Object.entries(types)) {
    if (!rawType || typeof rawType !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (rawType);

    const checkToolList = (key) => {
      const list = row[key];
      if (!Array.isArray(list)) return;
      for (const name of list) {
        if (typeof name !== 'string') continue;
        if (!ALL_TOOL_IDS.includes(name)) {
          warnings.push(`Unknown tool id "${name}" in types.${typeId}.${key}`);
        }
      }
    };

    checkToolList('allowedTools');
    checkToolList('deniedTools');

    if (typeof row.providerId === 'string') {
      const pid = row.providerId.trim();
      const mid = typeof row.modelId === 'string' ? row.modelId.trim() : '';
      if (pid === 'lm-studio-local' && !mid) {
        row.providerId = '';
      }
    }

    if (row.maxInputTokens !== undefined && row.maxInputTokens !== null) {
      const cap = Number(row.maxInputTokens);
      if (!Number.isFinite(cap) || cap < 1) {
        row.maxInputTokens = null;
      } else {
        row.maxInputTokens = Math.floor(cap);
      }
    }

    const policy = row.contextEnforcementPolicy;
    if (
      policy !== undefined &&
      policy !== 'summarize' &&
      policy !== 'slide' &&
      policy !== 'truncate' &&
      policy !== 'archive'
    ) {
      delete row.contextEnforcementPolicy;
      warnings.push(
        `Invalid contextEnforcementPolicy for types.${typeId}; removed`,
      );
    } else if (policy === 'archive') {
      warnings.push(
        `Sub-agent type "${typeId}" uses archive policy; treated as slide at runtime`,
      );
      row.contextEnforcementPolicy = 'slide';
    }

    if (row.archive !== undefined) {
      const normalized = normalizeArchiveConfig(row.archive);
      if (normalized) row.archive = normalized;
      else delete row.archive;
    }

    if (row.minRecentTurns !== undefined) {
      const n = Number(row.minRecentTurns);
      row.minRecentTurns =
        Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
    }

    if (row.summaryReserveTokens !== undefined) {
      const n = Number(row.summaryReserveTokens);
      row.summaryReserveTokens =
        Number.isFinite(n) && n >= 64 ? Math.floor(n) : undefined;
    }

    if (row.summarySchema !== undefined) {
      const schema = String(row.summarySchema).trim();
      if (!schema) {
        delete row.summarySchema;
      } else {
        row.summarySchema = schema.slice(0, 64);
      }
    }

    if (row.sampler !== undefined) {
      const normalized = normalizeSamplerPreset(row.sampler);
      if (normalized === null) {
        delete row.sampler;
      } else if (Object.keys(normalized).length === 0) {
        delete row.sampler;
      } else {
        row.sampler = normalized;
      }
    }

    if (row.thinkingMode !== undefined) {
      const normalized = normalizeThinkingTriState(row.thinkingMode);
      if (!normalized) {
        delete row.thinkingMode;
      } else {
        row.thinkingMode = normalized;
      }
    }

    delete row.maxToolTurns;
  }

  if (base.defaultMaxInputTokens !== undefined && base.defaultMaxInputTokens !== null) {
    const cap = Number(base.defaultMaxInputTokens);
    base.defaultMaxInputTokens =
      Number.isFinite(cap) && cap >= 1000 ? Math.min(Math.floor(cap), 200000) : null;
  }

  const defaultPolicy = base.defaultContextEnforcementPolicy;
  if (
    defaultPolicy !== undefined &&
    defaultPolicy !== 'summarize' &&
    defaultPolicy !== 'slide' &&
    defaultPolicy !== 'truncate'
  ) {
    delete base.defaultContextEnforcementPolicy;
  }

  if (base.defaultSummarySchema !== undefined) {
    const schema = String(base.defaultSummarySchema).trim();
    if (!schema) delete base.defaultSummarySchema;
    else base.defaultSummarySchema = schema.slice(0, 64);
  }

  return { config: base, warnings };
}

const SEARCH_PROVIDERS = new Set([
  'searxng',
  'tavily',
  'brave',
  'duckduckgo',
  'disabled',
]);
const SEARCH_FALLBACK_PROVIDERS = new Set(['tavily', 'brave', 'duckduckgo']);

/**
 * Default search.json (Deep Research provider chain + web_search prefs).
 * @returns {object}
 */
export function defaultSearchConfig() {
  return {
    provider: 'searxng',
    fallbackChain: ['tavily', 'brave', 'duckduckgo'],
    searxngUrl: 'http://localhost:8899',
    keys: { braveApiKey: '', tavilyApiKey: '' },
    resultCount: 10,
  };
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

/**
 * Normalize search.json (whitelist providers, clamp result count).
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeSearchConfig(raw) {
  const config = defaultSearchConfig();
  if (!raw || typeof raw !== 'object') return config;

  const stored = /** @type {Record<string, unknown>} */ (raw);
  if (typeof stored.provider === 'string' && SEARCH_PROVIDERS.has(stored.provider)) {
    config.provider = stored.provider;
  }

  if (Array.isArray(stored.fallbackChain)) {
    const chain = [];
    for (const item of stored.fallbackChain) {
      if (typeof item === 'string' && SEARCH_FALLBACK_PROVIDERS.has(item) && !chain.includes(item)) {
        chain.push(item);
      }
    }
    if (chain.length > 0) {
      config.fallbackChain = chain;
    }
  }

  if (typeof stored.searxngUrl === 'string') {
    const trimmed = stored.searxngUrl.trim();
    if (trimmed) {
      config.searxngUrl = trimmed.replace(/\/+$/, '');
    }
  }

  if (stored.keys && typeof stored.keys === 'object') {
    const keysMap = /** @type {Record<string, unknown>} */ (stored.keys);
    if (typeof keysMap.braveApiKey === 'string') {
      config.keys.braveApiKey = keysMap.braveApiKey;
    }
    if (typeof keysMap.tavilyApiKey === 'string') {
      config.keys.tavilyApiKey = keysMap.tavilyApiKey;
    }
  }

  config.resultCount = clampInt(stored.resultCount, 1, 50, config.resultCount);
  return config;
}

/**
 * Build initial search.json from legacy tools.json web search fields.
 * @param {object} toolsConfig normalized tools.json
 * @returns {object}
 */
export function seedSearchConfigFromTools(toolsConfig) {
  const providerByTools = {
    brave: 'brave',
    tavily: 'tavily',
    duckduckgo: 'duckduckgo',
  };
  const toolsProvider =
    toolsConfig && typeof toolsConfig.webSearchProvider === 'string'
      ? toolsConfig.webSearchProvider
      : 'duckduckgo';
  const mapped = providerByTools[toolsProvider] ?? 'duckduckgo';
  const keys =
    toolsConfig?.keys && typeof toolsConfig.keys === 'object'
      ? toolsConfig.keys
      : { braveApiKey: '', tavilyApiKey: '' };
  return normalizeSearchConfig({
    provider: mapped,
    keys: {
      braveApiKey: typeof keys.braveApiKey === 'string' ? keys.braveApiKey : '',
      tavilyApiKey: typeof keys.tavilyApiKey === 'string' ? keys.tavilyApiKey : '',
    },
  });
}

/**
 * Default research.json engine parameters.
 * @returns {object}
 */
export function defaultResearchConfig() {
  return {
    model: { providerId: '', model: '' },
    searchProvider: '',
    maxRounds: 0,
    minRounds: 3,
    maxTimeSeconds: 300,
    runTimeoutSeconds: 1800,
    maxReportTokens: 16384,
    extractionTimeoutSeconds: 90,
    extractionConcurrency: 3,
    maxUrlsPerRound: 3,
    maxContentChars: 15000,
    synthesisWindow: 10,
    maxEmptyRounds: 2,
  };
}

/**
 * Normalize research.json (clamp numeric engine limits).
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeResearchConfig(raw) {
  const config = defaultResearchConfig();
  if (!raw || typeof raw !== 'object') return config;

  const stored = /** @type {Record<string, unknown>} */ (raw);

  if (stored.model && typeof stored.model === 'object') {
    const model = /** @type {Record<string, unknown>} */ (stored.model);
    if (typeof model.providerId === 'string') {
      config.model.providerId = model.providerId.trim();
    }
    if (typeof model.model === 'string') {
      config.model.model = model.model.trim();
    }
  }

  if (typeof stored.searchProvider === 'string') {
    const trimmed = stored.searchProvider.trim();
    if (!trimmed || SEARCH_PROVIDERS.has(trimmed)) {
      config.searchProvider = trimmed;
    }
  }

  config.maxRounds = clampInt(stored.maxRounds, 0, 20, config.maxRounds);
  config.minRounds = clampInt(stored.minRounds, 1, 20, config.minRounds);
  config.maxTimeSeconds = clampInt(stored.maxTimeSeconds, 30, 3600, config.maxTimeSeconds);
  config.runTimeoutSeconds = clampInt(
    stored.runTimeoutSeconds,
    0,
    86_400,
    config.runTimeoutSeconds,
  );
  config.maxReportTokens = clampInt(
    stored.maxReportTokens,
    1024,
    131_072,
    config.maxReportTokens,
  );
  config.extractionTimeoutSeconds = clampInt(
    stored.extractionTimeoutSeconds,
    10,
    600,
    config.extractionTimeoutSeconds,
  );
  config.extractionConcurrency = clampInt(
    stored.extractionConcurrency,
    1,
    20,
    config.extractionConcurrency,
  );
  config.maxUrlsPerRound = clampInt(stored.maxUrlsPerRound, 1, 20, config.maxUrlsPerRound);
  config.maxContentChars = clampInt(
    stored.maxContentChars,
    1000,
    100_000,
    config.maxContentChars,
  );
  config.synthesisWindow = clampInt(stored.synthesisWindow, 1, 50, config.synthesisWindow);
  config.maxEmptyRounds = clampInt(stored.maxEmptyRounds, 1, 10, config.maxEmptyRounds);

  return config;
}

/** Managed local server ids allowed in servers.json (Phase 0: searxng only). */
const MANAGED_SERVER_IDS = ['searxng', 'llama-cpp'];

const DEFAULT_SERVER_PORTS = {
  searxng: 8899,
  'llama-cpp': 8085,
};

/**
 * Default servers.json (managed SearXNG and future local servers).
 * @returns {Record<string, { enabled: boolean, autoStart: boolean, port: number }>}
 */
export function defaultServersConfig() {
  return {
    searxng: {
      enabled: true,
      autoStart: true,
      port: DEFAULT_SERVER_PORTS.searxng,
    },
    'llama-cpp': {
      enabled: true,
      autoStart: false,
      port: DEFAULT_SERVER_PORTS['llama-cpp'],
    },
  };
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function coerceBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return fallback;
}

/**
 * Normalize servers.json (catalog ids only, clamp ports, coerce booleans).
 * @param {unknown} raw
 * @returns {Record<string, { enabled: boolean, autoStart: boolean, port: number }>}
 */
export function normalizeServersConfig(raw) {
  const config = defaultServersConfig();
  if (!raw || typeof raw !== 'object') return config;

  const stored = /** @type {Record<string, unknown>} */ (raw);
  for (const id of MANAGED_SERVER_IDS) {
    const entry = stored[id];
    if (!entry || typeof entry !== 'object') continue;

    const row = /** @type {Record<string, unknown>} */ (entry);
    const base = config[id];
    const defaultPort = DEFAULT_SERVER_PORTS[id] ?? 8899;

    config[id] = {
      enabled: coerceBool(row.enabled, base.enabled),
      autoStart: coerceBool(row.autoStart, base.autoStart),
      port: clampInt(row.port, 1024, 65_535, defaultPort),
    };
  }

  return config;
}
