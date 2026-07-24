/**
 * Email automation rules v2 (spec Part 4 / Phase 5).
 *
 * A rule is `{ conditions: [{ field, op, value }], trigger, actions: [...] }`:
 * a trigger picks the moment (new mail, high urgency, tag), the conditions
 * AND-narrow which messages qualify, and one or more actions run against each
 * match. Rules persist in ~/.minnow/email/automations.json; every execution is
 * recorded in the per-account `automation_runs` table (the audit log, surfaced
 * as the Runs tab).
 *
 * Guardrails (Part 7, absolute):
 *  - Automations never send mail. `forward_to` writes a *draft* for the user to
 *    review and send by hand — it never reaches SMTP on its own.
 *  - Mail-op actions (archive/move/read/flag) route through the Phase 4 review
 *    queue by default; only a rule the user explicitly marks `trusted` executes
 *    them directly. `delete` is not an automation action at all.
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { emailAutomationsPath } from './paths.js';
import { triageMessage } from './triage.js';
import { emitEmailEvent } from './events.js';
import { getMailDb, hydrateAttachments } from './store.js';
import { splitAddressHeader } from './contacts.js';
import { bulkMessageAction } from './mail-actions.js';
import { enqueuePendingAction } from './pending-actions.js';
import { enqueueSchedulerNotification } from '../scheduler/delivery.js';

/** Fields a condition may test against a message. */
export const CONDITION_FIELDS = ['sender', 'domain', 'subject', 'has_attachment', 'category', 'urgency'];

/** Comparison operators a condition may use. */
export const CONDITION_OPS = ['contains', 'not_contains', 'equals', 'not_equals', 'is_true', 'is_false'];

/** Triggers that pick the moment a rule is considered. */
export const AUTOMATION_TRIGGERS = ['on_new_message', 'on_high_urgency', 'on_tag_match'];

/** Every action type a rule may carry. */
export const ACTION_TYPES = [
  'triage',
  'generate_variants',
  'mark_read',
  'flag',
  'archive',
  'move_to_folder',
  'forward_to',
  'os_notify',
  'run_scheduler_job',
];

/** Mail-op actions that collapse onto the review-queue / bulk pipeline. */
const MAIL_OP_ACTIONS = {
  mark_read: 'read',
  flag: 'flag',
  archive: 'archive',
  move_to_folder: 'move',
};

/**
 * @typedef {object} AutomationCondition
 * @property {string} field
 * @property {string} op
 * @property {string} value
 */

/**
 * @typedef {object} AutomationAction
 * @property {string} type
 * @property {string} [folder]
 * @property {string} [to]
 * @property {string} [title]
 * @property {string} [body]
 * @property {string} [jobId]
 */

/**
 * @typedef {object} EmailAutomation
 * @property {string} id
 * @property {string} name
 * @property {boolean} enabled
 * @property {string} accountId
 * @property {string} trigger
 * @property {AutomationCondition[]} conditions
 * @property {AutomationAction[]} actions
 * @property {boolean} trusted
 * @property {Record<string, unknown>} [config]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

function nowIso() {
  return new Date().toISOString();
}

/** @param {unknown} raw */
function normalizeCondition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const field = String(/** @type {any} */ (raw).field ?? '').trim();
  const op = String(/** @type {any} */ (raw).op ?? '').trim();
  if (!CONDITION_FIELDS.includes(field) || !CONDITION_OPS.includes(op)) {
    return null;
  }
  return { field, op, value: String(/** @type {any} */ (raw).value ?? '') };
}

/**
 * Coerce a stored/legacy action into the v2 shape. A legacy rule stored a bare
 * `action` string plus a `config`; the old `notify` maps onto `os_notify`.
 * @param {unknown} raw
 * @param {Record<string, unknown>} [legacyConfig]
 */
function normalizeAction(raw, legacyConfig) {
  const isString = typeof raw === 'string';
  const source = isString ? {} : /** @type {Record<string, any>} */ (raw ?? {});
  const rawType = isString ? String(raw) : String(source.type ?? '').trim();
  const type = rawType === 'notify' ? 'os_notify' : rawType;
  if (!ACTION_TYPES.includes(type)) {
    return null;
  }

  /** @type {AutomationAction} */
  const action = { type };
  const cfg = legacyConfig && typeof legacyConfig === 'object' ? legacyConfig : {};
  if (type === 'move_to_folder') {
    action.folder = String(source.folder ?? cfg.folder ?? '').trim();
  }
  if (type === 'forward_to') {
    action.to = String(source.to ?? cfg.to ?? '').trim();
  }
  if (type === 'os_notify') {
    action.title = String(source.title ?? cfg.title ?? '').trim();
    action.body = String(source.body ?? cfg.body ?? '').trim();
  }
  if (type === 'run_scheduler_job') {
    action.jobId = String(source.jobId ?? cfg.jobId ?? '').trim();
  }
  return action;
}

/**
 * Migrate any stored rule (v1 single-action or v2) to the v2 shape.
 * @param {Record<string, any>} rule
 * @returns {EmailAutomation}
 */
export function normalizeRule(rule) {
  const conditions = Array.isArray(rule.conditions)
    ? rule.conditions.map(normalizeCondition).filter(Boolean)
    : [];

  let actions = [];
  if (Array.isArray(rule.actions) && rule.actions.length > 0) {
    actions = rule.actions.map((action) => normalizeAction(action)).filter(Boolean);
  } else if (rule.action) {
    // v1 rule: one action string plus a loose config bag.
    const legacy = normalizeAction(rule.action, rule.config);
    if (legacy) actions = [legacy];
  }

  const trigger = AUTOMATION_TRIGGERS.includes(String(rule.trigger))
    ? String(rule.trigger)
    : 'on_new_message';

  return {
    id: String(rule.id ?? ''),
    name: String(rule.name ?? 'Untitled rule').trim() || 'Untitled rule',
    enabled: rule.enabled !== false,
    accountId: String(rule.accountId ?? '').trim(),
    trigger,
    conditions,
    actions,
    trusted: rule.trusted === true,
    config: rule.config && typeof rule.config === 'object' ? rule.config : {},
    createdAt: String(rule.createdAt ?? ''),
    updatedAt: String(rule.updatedAt ?? ''),
  };
}

/** Read the raw rules array exactly as stored. */
async function readRulesFromDisk() {
  const filePath = emailAutomationsPath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.rules) ? parsed.rules : [];
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * @returns {Promise<EmailAutomation[]>}
 */
export async function listAutomations() {
  const rules = await readRulesFromDisk();
  return rules.map(normalizeRule);
}

/**
 * @param {EmailAutomation[]} rules
 */
async function writeAutomations(rules) {
  const filePath = emailAutomationsPath();
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(
    tmp,
    `${JSON.stringify({ version: 2, rules, updatedAt: nowIso() }, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(tmp, filePath);
}

/**
 * @param {Record<string, unknown>} input
 */
export async function createAutomation(input) {
  const rules = await readRulesFromDisk();
  const now = nowIso();
  const rule = normalizeRule({
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  });
  if (!rule.accountId) {
    throw new Error('accountId is required');
  }
  if (rule.actions.length === 0) {
    throw new Error('At least one action is required');
  }
  rules.push(rule);
  await writeAutomations(rules.map(normalizeRule));
  return rule;
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
export async function updateAutomation(id, patch) {
  const rules = await readRulesFromDisk();
  const index = rules.findIndex((row) => row.id === id);
  if (index < 0) {
    throw new Error('Automation not found');
  }
  const prev = normalizeRule(rules[index]);
  const merged = normalizeRule({
    ...prev,
    ...patch,
    id: prev.id,
    accountId: prev.accountId,
    createdAt: prev.createdAt,
    updatedAt: nowIso(),
  });
  rules[index] = merged;
  await writeAutomations(rules.map(normalizeRule));
  return merged;
}

/**
 * @param {string} id
 */
export async function deleteAutomation(id) {
  const rules = await readRulesFromDisk();
  const next = rules.filter((row) => row.id !== id);
  if (next.length === rules.length) {
    throw new Error('Automation not found');
  }
  await writeAutomations(next.map(normalizeRule));
  return { deleted: true };
}

/**
 * Remove all automation rules bound to an email account (sign-out cleanup).
 * @param {string} accountId
 */
export async function deleteAutomationsForAccount(accountId) {
  const rules = await readRulesFromDisk();
  const next = rules.filter((row) => row.accountId !== accountId);
  if (next.length === rules.length) {
    return { removed: 0 };
  }
  await writeAutomations(next.map(normalizeRule));
  return { removed: rules.length - next.length };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The lowercased value a condition field reads off a message.
 * @param {string} field
 * @param {Record<string, any>} message
 */
function fieldValue(field, message) {
  const from = String(message.from ?? '');
  switch (field) {
    case 'sender':
      return from.toLowerCase();
    case 'domain': {
      const address = splitAddressHeader(from).address.toLowerCase();
      const at = address.lastIndexOf('@');
      return at >= 0 ? address.slice(at + 1) : '';
    }
    case 'subject':
      return String(message.subject ?? '').toLowerCase();
    case 'category':
      // Prefer local inbox tab when set; fall back to triage category.
      return String(message.category || message.triage?.category || '').toLowerCase();
    case 'urgency':
      return String(message.triage?.urgency ?? '').toLowerCase();
    case 'has_attachment':
      return message.hasAttachments ? 'true' : 'false';
    default:
      return '';
  }
}

/**
 * Match a category condition against either the inbox tab or triage category
 * so rules like `equals newsletter` and `equals other` both keep working.
 * @param {string} op
 * @param {string} value
 * @param {Record<string, any>} message
 */
function matchCategoryCondition(op, value, message) {
  const candidates = [
    String(message.category ?? '').toLowerCase(),
    String(message.triage?.category ?? '').toLowerCase(),
  ].filter(Boolean);
  const any = (pred) => candidates.some(pred);
  const every = (pred) => candidates.length > 0 && candidates.every(pred);
  switch (op) {
    case 'contains':
      return value.length > 0 && any((c) => c.includes(value));
    case 'not_contains':
      return value.length === 0 || every((c) => !c.includes(value));
    case 'equals':
      return any((c) => c === value);
    case 'not_equals':
      return candidates.length === 0 || every((c) => c !== value);
    default:
      return false;
  }
}

/**
 * @param {AutomationCondition} cond
 * @param {Record<string, any>} message
 */
export function matchCondition(cond, message) {
  const value = String(cond?.value ?? '').trim().toLowerCase();
  const field = String(cond?.field ?? '');
  if (field === 'category') {
    return matchCategoryCondition(cond?.op, value, message);
  }
  const actual = fieldValue(field, message);
  switch (cond?.op) {
    case 'contains':
      return value.length > 0 && actual.includes(value);
    case 'not_contains':
      return value.length === 0 || !actual.includes(value);
    case 'equals':
      return actual === value;
    case 'not_equals':
      return actual !== value;
    case 'is_true':
      return actual === 'true';
    case 'is_false':
      return actual === 'false';
    default:
      return false;
  }
}

/**
 * All conditions must hold (AND). An empty condition list matches everything.
 * @param {AutomationCondition[]} conditions
 * @param {Record<string, any>} message
 */
export function matchesConditions(conditions, message) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return true;
  }
  return conditions.every((cond) => matchCondition(cond, message));
}

/**
 * Whether the rule's trigger fires for this message.
 * @param {EmailAutomation} rule
 * @param {Record<string, any>} message
 */
export function triggerMatches(rule, message) {
  if (!rule.enabled) {
    return false;
  }
  if (rule.accountId && String(message.accountId ?? '') !== rule.accountId) {
    return false;
  }

  switch (rule.trigger) {
    case 'on_new_message':
      return true;
    case 'on_high_urgency':
      return String(message.triage?.urgency ?? '').toLowerCase() === 'high';
    case 'on_tag_match': {
      const needle = String(rule.config?.tag ?? '').trim().toLowerCase();
      if (!needle) return false;
      const tags = Array.isArray(message.triage?.tags) ? message.triage.tags : [];
      return tags.some((tag) => String(tag).toLowerCase() === needle);
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** @param {Record<string, any>} row */
function rowToRun(row) {
  return {
    id: row.id,
    ruleId: row.rule_id,
    messageRowId: row.message_row_id ?? null,
    action: row.action,
    outcome: row.outcome,
    detail: row.detail || '',
    ranAt: row.ran_at || '',
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ ruleId: string, messageRowId?: number | null, action: string, outcome: string, detail?: string }} input
 */
export function recordAutomationRun(db, input) {
  db.prepare(
    `INSERT INTO automation_runs (rule_id, message_row_id, action, outcome, detail, ran_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    String(input.ruleId ?? ''),
    Number.isFinite(input.messageRowId) ? Number(input.messageRowId) : null,
    String(input.action ?? ''),
    String(input.outcome ?? ''),
    String(input.detail ?? ''),
    nowIso(),
  );
}

/**
 * @param {string} accountId
 * @param {string} ruleId
 * @param {{ limit?: number }} [options]
 */
export async function listAutomationRuns(accountId, ruleId, options = {}) {
  const db = getMailDb(accountId);
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
  const rows = db
    .prepare('SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY id DESC LIMIT ?')
    .all(String(ruleId ?? ''), limit);
  return rows.map(rowToRun);
}

/**
 * Runs for a rule, resolving the owning account from the rule itself so the
 * route does not need the account id in the URL.
 * @param {string} ruleId
 * @param {{ limit?: number }} [options]
 */
export async function listAutomationRunsForRule(ruleId, options = {}) {
  const rules = await listAutomations();
  const rule = rules.find((row) => row.id === ruleId);
  if (!rule) {
    throw new Error('Automation not found');
  }
  return listAutomationRuns(rule.accountId, ruleId, options);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Build a forward draft. Never sends — the draft is the "confirm queue" the
 * guardrail requires: the user opens it and clicks Send themselves.
 * @param {string} accountId
 * @param {string} to
 * @param {Record<string, any>} message
 */
async function createForwardDraft(accountId, to, message) {
  const { saveDraft } = await import('./drafts.js');
  const subjectRaw = String(message.subject ?? '');
  const subject = /^\s*fwd?:/i.test(subjectRaw) ? subjectRaw : `Fwd: ${subjectRaw}`.trim();
  const original = String(message.bodyText ?? message.bodyPreview ?? '');
  const header =
    '\n\n---------- Forwarded message ----------\n' +
    `From: ${String(message.from ?? '')}\n` +
    `Subject: ${subjectRaw}\n` +
    `Date: ${String(message.date ?? '')}\n\n`;
  return saveDraft(accountId, {
    threadId: String(message.threadId ?? ''),
    mode: 'forward',
    to,
    subject,
    body: `${header}${original}`,
  });
}

/**
 * Run one action against one message and record the outcome. Never throws:
 * a failing action is logged to the audit table, not propagated.
 * @param {string} accountId
 * @param {EmailAutomation} rule
 * @param {AutomationAction} action
 * @param {Record<string, any>} message
 * @param {string} messageKey
 */
async function runAutomationAction(accountId, rule, action, message, messageKey) {
  const db = getMailDb(accountId);
  const messageRowId = Number.isFinite(message.messageRowId) ? Number(message.messageRowId) : null;
  let outcome = 'applied';
  let detail = '';

  try {
    switch (action.type) {
      case 'triage':
        await triageMessage(accountId, messageKey);
        break;

      case 'generate_variants':
        if (message.threadId) {
          const { generateReplyVariants } = await import('./agent.js');
          await generateReplyVariants(accountId, String(message.threadId), { messageKey });
        } else {
          outcome = 'skipped';
          detail = 'no thread';
        }
        break;

      case 'mark_read':
      case 'flag':
      case 'archive':
      case 'move_to_folder': {
        const mailAction = MAIL_OP_ACTIONS[action.type];
        const destFolder = action.type === 'move_to_folder' ? String(action.folder ?? '').trim() : undefined;
        if (action.type === 'move_to_folder' && !destFolder) {
          outcome = 'failed';
          detail = 'destination folder required';
          break;
        }
        if (rule.trusted) {
          // Explicitly trusted: apply the mail-op straight away.
          const result = await bulkMessageAction(accountId, {
            ids: [messageKey],
            action: mailAction,
            destFolder,
          });
          if (result.failed > 0) {
            outcome = 'failed';
            detail = `${result.failed} of 1 failed`;
          }
        } else {
          // Default: route through the Phase 4 review queue for the user to
          // Apply / Dismiss. The pending row is the second audit trail.
          await enqueuePendingAction(accountId, {
            source: `automation:${rule.id}`,
            label: `${rule.name}: ${action.type.replace(/_/g, ' ')}`,
            action: mailAction,
            messageIds: [messageKey],
            destFolder,
            detail: `Automation "${rule.name}"`,
          });
          outcome = 'queued';
        }
        break;
      }

      case 'forward_to': {
        const to = String(action.to ?? '').trim();
        if (!to) {
          outcome = 'failed';
          detail = 'recipient required';
          break;
        }
        // Absolute guardrail: never send. A forward becomes a draft to review.
        const draft = await createForwardDraft(accountId, to, message);
        outcome = 'drafted';
        detail = `Forward draft to ${to} (${draft.id})`;
        break;
      }

      case 'os_notify': {
        const title = String(action.title ?? '').trim() || rule.name;
        const bodyText = String(action.body ?? '').trim() || String(message.subject ?? 'New mail');
        await enqueueSchedulerNotification({
          jobId: `email-automation:${rule.id}:${messageKey}`,
          label: title,
          message: bodyText,
        });
        // Keep the in-app SSE too, so an open dashboard can flash the toast.
        emitEmailEvent('automation_notify', {
          accountId,
          messageId: messageKey,
          ruleId: rule.id,
          title,
          body: bodyText,
        });
        outcome = 'notified';
        break;
      }

      case 'run_scheduler_job': {
        const jobId = String(action.jobId ?? '').trim();
        if (!jobId) {
          outcome = 'failed';
          detail = 'jobId required';
          break;
        }
        const { runJobNow } = await import('../scheduler/runner.js');
        await runJobNow(jobId, { trigger: 'email-automation' });
        outcome = 'ran';
        detail = `job ${jobId}`;
        break;
      }

      default:
        outcome = 'skipped';
        detail = `unknown action ${action.type}`;
    }
  } catch (err) {
    outcome = 'failed';
    detail = err instanceof Error ? err.message : String(err);
    console.warn(
      `[email/automations] rule ${rule.id} action ${action.type} failed:`,
      detail,
    );
  }

  recordAutomationRun(db, {
    ruleId: rule.id,
    messageRowId,
    action: action.type,
    outcome,
    detail,
  });
}

/**
 * Run matching automations for one new message.
 * @param {string} accountId
 * @param {Record<string, any>} message
 */
export async function evaluateAutomationsForMessage(accountId, message) {
  const rules = await listAutomations();
  const messageKey = String(message.id ?? `${message.folder}:${message.uid}`);

  for (const rule of rules) {
    if (rule.accountId !== accountId) {
      continue;
    }
    if (!triggerMatches(rule, { ...message, accountId })) {
      continue;
    }
    if (!matchesConditions(rule.conditions, message)) {
      continue;
    }
    for (const action of rule.actions) {
      // Each action records its own run and swallows its own errors, so one
      // bad action never aborts the rest of the rule.
      // eslint-disable-next-line no-await-in-loop
      await runAutomationAction(accountId, rule, action, message, messageKey);
    }
  }
}

/**
 * Preview how many recently stored messages a (possibly unsaved) rule would
 * have matched — trigger + conditions, no actions run.
 * @param {string} accountId
 * @param {Record<string, unknown>} ruleInput
 * @param {{ days?: number }} [options]
 */
export async function dryRunAutomation(accountId, ruleInput, options = {}) {
  const days = Math.min(90, Math.max(1, Number(options.days) || 7));
  const since = Date.now() - days * 86_400_000;
  const db = getMailDb(accountId);
  const rows = db
    .prepare('SELECT * FROM messages WHERE date_ms >= ? ORDER BY date_ms DESC LIMIT 2000')
    .all(since);
  const messages = hydrateAttachments(db, rows).filter(Boolean);

  // Force enabled so a disabled draft still previews; scope to this account.
  const rule = normalizeRule({ ...ruleInput, accountId, enabled: true });

  const matched = [];
  for (const message of messages) {
    if (!triggerMatches(rule, { ...message, accountId })) continue;
    if (!matchesConditions(rule.conditions, message)) continue;
    matched.push(message);
  }

  return {
    days,
    total: messages.length,
    matched: matched.length,
    sample: matched.slice(0, 8).map((message) => ({
      id: message.id,
      from: message.from,
      subject: message.subject,
      date: message.date,
    })),
  };
}
