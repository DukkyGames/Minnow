/**
 * Email automation rules — persisted in ~/.minnow/email/automations.json.
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { emailAutomationsPath } from './paths.js';
import { triageMessage } from './triage.js';
import { emitEmailEvent } from './events.js';

/**
 * @typedef {object} EmailAutomation
 * @property {string} id
 * @property {string} name
 * @property {boolean} enabled
 * @property {string} accountId
 * @property {string} trigger
 * @property {string} action
 * @property {Record<string, unknown>} [config]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @returns {Promise<EmailAutomation[]>}
 */
export async function listAutomations() {
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
 * @param {EmailAutomation[]} rules
 */
async function writeAutomations(rules) {
  const filePath = emailAutomationsPath();
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(
    tmp,
    `${JSON.stringify({ version: 1, rules, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(tmp, filePath);
}

/**
 * @param {Record<string, unknown>} input
 */
export async function createAutomation(input) {
  const rules = await listAutomations();
  const now = new Date().toISOString();
  const rule = {
    id: randomUUID(),
    name: String(input.name ?? 'Untitled rule').trim(),
    enabled: input.enabled !== false,
    accountId: String(input.accountId ?? '').trim(),
    trigger: String(input.trigger ?? 'on_new_message').trim(),
    action: String(input.action ?? 'triage').trim(),
    config: input.config && typeof input.config === 'object' ? input.config : {},
    createdAt: now,
    updatedAt: now,
  };
  if (!rule.accountId) {
    throw new Error('accountId is required');
  }
  rules.push(rule);
  await writeAutomations(rules);
  return rule;
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
export async function updateAutomation(id, patch) {
  const rules = await listAutomations();
  const index = rules.findIndex((row) => row.id === id);
  if (index < 0) {
    throw new Error('Automation not found');
  }
  const prev = rules[index];
  rules[index] = {
    ...prev,
    ...patch,
    id: prev.id,
    updatedAt: new Date().toISOString(),
  };
  await writeAutomations(rules);
  return rules[index];
}

/**
 * @param {string} id
 */
export async function deleteAutomation(id) {
  const rules = await listAutomations();
  const next = rules.filter((row) => row.id !== id);
  if (next.length === rules.length) {
    throw new Error('Automation not found');
  }
  await writeAutomations(next);
  return { deleted: true };
}

/**
 * Remove all automation rules bound to an email account (sign-out cleanup).
 * @param {string} accountId
 */
export async function deleteAutomationsForAccount(accountId) {
  const rules = await listAutomations();
  const next = rules.filter((row) => row.accountId !== accountId);
  if (next.length === rules.length) {
    return { removed: 0 };
  }
  await writeAutomations(next);
  return { removed: rules.length - next.length };
}

/**
 * Match automation trigger against a message.
 * @param {EmailAutomation} rule
 * @param {Record<string, unknown>} message
 */
function triggerMatches(rule, message) {
  if (!rule.enabled) {
    return false;
  }
  if (rule.accountId && String(message.accountId ?? '') !== rule.accountId) {
    return false;
  }

  const trigger = rule.trigger;
  if (trigger === 'on_new_message') {
    return true;
  }
  if (trigger === 'on_high_urgency') {
    return String(message.triage?.urgency ?? '').toLowerCase() === 'high';
  }
  if (trigger === 'on_tag_match') {
    const needle = String(rule.config?.tag ?? '').trim().toLowerCase();
    if (!needle) {
      return false;
    }
    const tags = Array.isArray(message.triage?.tags) ? message.triage.tags : [];
    return tags.some((tag) => String(tag).toLowerCase() === needle);
  }
  return false;
}

/**
 * Run matching automations for one new message.
 * @param {string} accountId
 * @param {Record<string, unknown>} message
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

    try {
      if (rule.action === 'triage') {
        await triageMessage(accountId, messageKey);
      } else if (rule.action === 'generate_variants' && message.threadId) {
        const { generateReplyVariants } = await import('./agent.js');
        await generateReplyVariants(accountId, String(message.threadId), { messageKey });
      } else if (rule.action === 'notify') {
        emitEmailEvent('automation_notify', {
          accountId,
          messageId: messageKey,
          ruleId: rule.id,
          title: String(rule.config?.title ?? rule.name),
          body: String(rule.config?.body ?? message.subject ?? 'New mail'),
        });
      }
    } catch (err) {
      console.warn(
        `[email/automations] rule ${rule.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
