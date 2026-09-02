import { appConfirm } from '../app-dialog';
/** Email automation rules — condition builder, multi-action rules, dry-run preview, and a per-rule Runs (audit) view. */

import type {
  EmailAccount,
  EmailAutomation,
  EmailAutomationAction,
  EmailAutomationActionType,
  EmailAutomationCondition,
  EmailAutomationConditionField,
  EmailAutomationConditionOp,
  EmailAutomationRun,
  EmailAutomationTrigger,
} from '../../email/client';
import {
  deleteAutomationRule,
  dryRunAutomation,
  fetchAutomationRuns,
  fetchAutomations,
  saveAutomation,
  updateAutomationRule,
} from '../../email/client-ext';

export interface EmailAutomationsOptions {
  account: EmailAccount;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
  onClose: () => void;
}

const TRIGGERS: Array<{ value: EmailAutomationTrigger; label: string }> = [
  { value: 'on_new_message', label: 'On new message' },
  { value: 'on_high_urgency', label: 'On high urgency' },
  { value: 'on_tag_match', label: 'On tag match' },
];

const CONDITION_FIELDS: Array<{ value: EmailAutomationConditionField; label: string; boolean?: boolean }> = [
  { value: 'sender', label: 'Sender' },
  { value: 'domain', label: 'Domain' },
  { value: 'subject', label: 'Subject' },
  { value: 'category', label: 'Category' },
  { value: 'urgency', label: 'Urgency' },
  { value: 'has_attachment', label: 'Has attachment', boolean: true },
];

const TEXT_OPS: Array<{ value: EmailAutomationConditionOp; label: string }> = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: "doesn't equal" },
];

const BOOL_OPS: Array<{ value: EmailAutomationConditionOp; label: string }> = [
  { value: 'is_true', label: 'is true' },
  { value: 'is_false', label: 'is false' },
];

const ACTIONS: Array<{ value: EmailAutomationActionType; label: string }> = [
  { value: 'triage', label: 'Triage' },
  { value: 'generate_variants', label: 'Draft reply variants' },
  { value: 'mark_read', label: 'Mark read' },
  { value: 'flag', label: 'Flag' },
  { value: 'archive', label: 'Archive' },
  { value: 'move_to_folder', label: 'Move to folder' },
  { value: 'forward_to', label: 'Forward (draft)' },
  { value: 'os_notify', label: 'Notify' },
  { value: 'run_scheduler_job', label: 'Run scheduler job' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function option(select: HTMLSelectElement, value: string, label: string): void {
  const opt = el('option') as HTMLOptionElement;
  opt.value = value;
  opt.textContent = label;
  select.appendChild(opt);
}

// ── Conditions ───────────────────────────────────────────────────────────────

/** Human-readable one-liner for a condition. */
function conditionText(cond: EmailAutomationCondition): string {
  const field = CONDITION_FIELDS.find((f) => f.value === cond.field)?.label ?? cond.field;
  const op = [...TEXT_OPS, ...BOOL_OPS].find((o) => o.value === cond.op)?.label ?? cond.op;
  return cond.op === 'is_true' || cond.op === 'is_false'
    ? `${field} ${op}`
    : `${field} ${op} "${cond.value}"`;
}

/** Human-readable one-liner for an action. */
function actionText(action: EmailAutomationAction): string {
  const label = ACTIONS.find((a) => a.value === action.type)?.label ?? action.type;
  if (action.type === 'move_to_folder') return `${label} → ${action.folder || '?'}`;
  if (action.type === 'forward_to') return `${label} → ${action.to || '?'}`;
  if (action.type === 'run_scheduler_job') return `${label} (${action.jobId || '?'})`;
  return label;
}

// ── Automations ──────────────────────────────────────────────────────────────

/**
 * Render automation drawer content.
 */
export async function renderEmailAutomations(
  mount: HTMLElement,
  options: EmailAutomationsOptions,
): Promise<void> {
  mount.replaceChildren(el('p', 'email-loading', 'Loading automations…'));
  mount.className = 'email-automations';

  let rules: EmailAutomation[] = [];
  try {
    rules = await fetchAutomations();
  } catch (err) {
    mount.replaceChildren(
      el('p', 'email-empty is-err', err instanceof Error ? err.message : 'Load failed'),
    );
    return;
  }

  const accountRules = rules.filter((row) => row.accountId === options.account.id);

  const header = el('div', 'email-automations-head');
  header.appendChild(el('h3', '', 'Email automations'));
  const closeBtn = el('button', 'email-btn', 'Close') as HTMLButtonElement;
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', options.onClose);
  header.appendChild(closeBtn);

  mount.replaceChildren(header);

  const list = el('div', 'email-automations-list');
  if (accountRules.length === 0) {
    list.appendChild(
      el('p', 'email-empty', 'No rules yet. Build one below to act on new mail.'),
    );
  }

  for (const rule of accountRules) {
    list.appendChild(renderRuleRow(mount, options, rule));
  }
  mount.appendChild(list);

  mount.appendChild(renderBuilder(mount, options));
}

/** One saved rule: summary + enable/runs/delete controls. */
function renderRuleRow(
  mount: HTMLElement,
  options: EmailAutomationsOptions,
  rule: EmailAutomation,
): HTMLElement {
  const row = el('article', 'email-automation-row');

  const title = el('div', 'email-automation-title');
  const name = el('h4', '', rule.name);
  title.appendChild(name);
  if (rule.trusted) {
    title.appendChild(el('span', 'email-chip email-chip-trusted', 'trusted'));
  }
  if (!rule.enabled) {
    title.appendChild(el('span', 'email-chip', 'disabled'));
  }
  row.appendChild(title);

  const triggerLabel = TRIGGERS.find((t) => t.value === rule.trigger)?.label ?? rule.trigger;
  row.appendChild(el('p', 'email-automation-meta', `Trigger: ${triggerLabel}`));

  if (rule.conditions.length > 0) {
    row.appendChild(
      el('p', 'email-automation-meta', `When: ${rule.conditions.map(conditionText).join(' AND ')}`),
    );
  }
  row.appendChild(
    el(
      'p',
      'email-automation-meta',
      `Do: ${rule.actions.map(actionText).join(', ') || '(none)'}`,
    ),
  );

  const toggle = el('button', 'email-btn', rule.enabled ? 'Disable' : 'Enable') as HTMLButtonElement;
  toggle.type = 'button';
  toggle.addEventListener('click', async () => {
    try {
      await updateAutomationRule(rule.id, { enabled: !rule.enabled });
      options.onStatus?.('ok', 'Rule updated');
      void renderEmailAutomations(mount, options);
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Update failed');
    }
  });

  const runsBtn = el('button', 'email-btn', 'Runs') as HTMLButtonElement;
  runsBtn.type = 'button';
  runsBtn.addEventListener('click', () => {
    void renderRuns(mount, options, rule);
  });

  const remove = el('button', 'email-btn email-btn-danger', 'Delete') as HTMLButtonElement;
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    if (!(await appConfirm(`Delete rule "${rule.name}"?`))) return;
    try {
      await deleteAutomationRule(rule.id);
      options.onStatus?.('ok', 'Rule deleted');
      void renderEmailAutomations(mount, options);
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Delete failed');
    }
  });

  const actions = el('div', 'email-actions');
  actions.appendChild(toggle);
  actions.appendChild(runsBtn);
  actions.appendChild(remove);
  row.appendChild(actions);
  return row;
}

/** Per-rule audit log view. */
async function renderRuns(
  mount: HTMLElement,
  options: EmailAutomationsOptions,
  rule: EmailAutomation,
): Promise<void> {
  const header = el('div', 'email-automations-head');
  header.appendChild(el('h3', '', `Runs — ${rule.name}`));
  const backBtn = el('button', 'email-btn', 'Back') as HTMLButtonElement;
  backBtn.type = 'button';
  backBtn.addEventListener('click', () => {
    void renderEmailAutomations(mount, options);
  });
  header.appendChild(backBtn);
  mount.replaceChildren(header);

  let runs: EmailAutomationRun[] = [];
  try {
    runs = await fetchAutomationRuns(rule.id);
  } catch (err) {
    mount.appendChild(
      el('p', 'email-empty is-err', err instanceof Error ? err.message : 'Load failed'),
    );
    return;
  }

  if (runs.length === 0) {
    mount.appendChild(el('p', 'email-empty', 'No runs recorded yet.'));
    return;
  }

  const table = el('div', 'email-automation-runs');
  for (const run of runs) {
    const item = el('div', 'email-automation-run');
    const line = el('div', 'email-automation-run-line');
    line.appendChild(el('span', 'email-automation-run-action', run.action));
    line.appendChild(
      el('span', `email-chip email-run-outcome outcome-${run.outcome}`, run.outcome),
    );
    item.appendChild(line);
    const when = run.ranAt ? new Date(run.ranAt).toLocaleString() : '';
    item.appendChild(el('p', 'email-automation-meta', [when, run.detail].filter(Boolean).join(' · ')));
    table.appendChild(item);
  }
  mount.appendChild(table);
}

// ── Builder ──────────────────────────────────────────────────────────────────

/** The new-rule builder form. */
function renderBuilder(mount: HTMLElement, options: EmailAutomationsOptions): HTMLElement {
  const conditions: EmailAutomationCondition[] = [];
  const actions: EmailAutomationAction[] = [{ type: 'triage' }];

  const form = el('form', 'email-automation-form');
  form.appendChild(el('h4', '', 'New rule'));

  const nameInput = el('input', 'email-input') as HTMLInputElement;
  nameInput.name = 'name';
  nameInput.placeholder = 'Rule name';
  nameInput.required = true;
  form.appendChild(nameInput);

  const triggerRow = el('label', 'email-automation-field');
  triggerRow.appendChild(el('span', 'email-automation-label', 'Trigger'));
  const triggerSelect = el('select', 'email-select') as HTMLSelectElement;
  for (const t of TRIGGERS) option(triggerSelect, t.value, t.label);
  triggerRow.appendChild(triggerSelect);
  form.appendChild(triggerRow);

  const tagRow = el('label', 'email-automation-field');
  tagRow.appendChild(el('span', 'email-automation-label', 'Tag'));
  const tagInput = el('input', 'email-input') as HTMLInputElement;
  tagInput.placeholder = 'tag to match';
  tagRow.appendChild(tagInput);
  tagRow.hidden = true;
  form.appendChild(tagRow);
  triggerSelect.addEventListener('change', () => {
    tagRow.hidden = triggerSelect.value !== 'on_tag_match';
  });

  form.appendChild(el('h5', 'email-automation-subhead', 'Conditions (all must match)'));
  const condList = el('div', 'email-automation-rows');
  form.appendChild(condList);

  const addCond = el('button', 'email-btn', '+ Add condition') as HTMLButtonElement;
  addCond.type = 'button';
  addCond.addEventListener('click', () => {
    const cond: EmailAutomationCondition = { field: 'sender', op: 'contains', value: '' };
    conditions.push(cond);
    condList.appendChild(buildConditionRow(cond, conditions, condList));
  });
  form.appendChild(addCond);

  form.appendChild(el('h5', 'email-automation-subhead', 'Actions'));
  const actionList = el('div', 'email-automation-rows');
  form.appendChild(actionList);
  actionList.appendChild(buildActionRow(actions[0], actions, actionList));

  const addAction = el('button', 'email-btn', '+ Add action') as HTMLButtonElement;
  addAction.type = 'button';
  addAction.addEventListener('click', () => {
    const action: EmailAutomationAction = { type: 'triage' };
    actions.push(action);
    actionList.appendChild(buildActionRow(action, actions, actionList));
  });
  form.appendChild(addAction);

  const trustedRow = el('label', 'email-automation-check');
  const trustedInput = el('input') as HTMLInputElement;
  trustedInput.type = 'checkbox';
  trustedRow.appendChild(trustedInput);
  trustedRow.appendChild(
    el(
      'span',
      '',
      'Trusted — apply mail-op actions directly (otherwise they wait in the review queue). Forwards are always drafted, never sent.',
    ),
  );
  form.appendChild(trustedRow);

  const collectRule = () => ({
    name: nameInput.value.trim(),
    accountId: options.account.id,
    trigger: triggerSelect.value as EmailAutomationTrigger,
    conditions,
    actions,
    trusted: trustedInput.checked,
    config: triggerSelect.value === 'on_tag_match' ? { tag: tagInput.value.trim() } : {},
  });

  const dryRow = el('div', 'email-automation-dryrun');
  const dryBtn = el('button', 'email-btn', 'Dry-run (last 7 days)') as HTMLButtonElement;
  dryBtn.type = 'button';
  const dryResult = el('span', 'email-automation-dryrun-result', '');
  dryBtn.addEventListener('click', async () => {
    dryResult.textContent = 'Checking…';
    try {
      const preview = await dryRunAutomation(collectRule(), 7);
      dryResult.textContent = `Would have matched ${preview.matched} of ${preview.total} messages this week.`;
    } catch (err) {
      dryResult.textContent = err instanceof Error ? err.message : 'Dry-run failed';
    }
  });
  dryRow.appendChild(dryBtn);
  dryRow.appendChild(dryResult);
  form.appendChild(dryRow);

  const submit = el('button', 'email-btn email-btn-primary', 'Add rule') as HTMLButtonElement;
  submit.type = 'submit';
  form.appendChild(submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (actions.length === 0) {
      options.onStatus?.('err', 'Add at least one action');
      return;
    }
    try {
      await saveAutomation({ ...collectRule(), enabled: true });
      options.onStatus?.('ok', 'Rule created');
      void renderEmailAutomations(mount, options);
    } catch (err) {
      options.onStatus?.('err', err instanceof Error ? err.message : 'Save failed');
    }
  });

  return form;
}

/** One editable condition row bound to `cond`. */
function buildConditionRow(
  cond: EmailAutomationCondition,
  conditions: EmailAutomationCondition[],
  container: HTMLElement,
): HTMLElement {
  const rowEl = el('div', 'email-automation-row-edit');

  const fieldSelect = el('select', 'email-select') as HTMLSelectElement;
  fieldSelect.setAttribute('aria-label', 'Condition field');
  for (const f of CONDITION_FIELDS) option(fieldSelect, f.value, f.label);
  fieldSelect.value = cond.field;

  const opSelect = el('select', 'email-select') as HTMLSelectElement;
  opSelect.setAttribute('aria-label', 'Condition operator');
  const valueInput = el('input', 'email-input') as HTMLInputElement;
  valueInput.setAttribute('aria-label', 'Condition value');
  valueInput.placeholder = 'value';
  valueInput.value = cond.value;

  const syncOps = () => {
    const field = CONDITION_FIELDS.find((f) => f.value === fieldSelect.value);
    const ops = field?.boolean ? BOOL_OPS : TEXT_OPS;
    opSelect.replaceChildren();
    for (const o of ops) option(opSelect, o.value, o.label);
    if (!ops.some((o) => o.value === cond.op)) {
      cond.op = ops[0].value;
    }
    opSelect.value = cond.op;
    valueInput.hidden = Boolean(field?.boolean);
  };

  fieldSelect.addEventListener('change', () => {
    cond.field = fieldSelect.value as EmailAutomationConditionField;
    syncOps();
  });
  opSelect.addEventListener('change', () => {
    cond.op = opSelect.value as EmailAutomationConditionOp;
  });
  valueInput.addEventListener('input', () => {
    cond.value = valueInput.value;
  });

  const remove = el('button', 'email-btn email-btn-icon', '×') as HTMLButtonElement;
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove condition');
  remove.addEventListener('click', () => {
    const idx = conditions.indexOf(cond);
    if (idx >= 0) conditions.splice(idx, 1);
    rowEl.remove();
  });

  syncOps();
  rowEl.appendChild(fieldSelect);
  rowEl.appendChild(opSelect);
  rowEl.appendChild(valueInput);
  rowEl.appendChild(remove);
  void container;
  return rowEl;
}

/** One editable action row bound to `action`. */
function buildActionRow(
  action: EmailAutomationAction,
  actions: EmailAutomationAction[],
  container: HTMLElement,
): HTMLElement {
  const rowEl = el('div', 'email-automation-row-edit');

  const typeSelect = el('select', 'email-select') as HTMLSelectElement;
  typeSelect.setAttribute('aria-label', 'Action type');
  for (const a of ACTIONS) option(typeSelect, a.value, a.label);
  typeSelect.value = action.type;

  const paramInput = el('input', 'email-input') as HTMLInputElement;
  paramInput.setAttribute('aria-label', 'Action value');

  const syncParam = () => {
    switch (action.type) {
      case 'move_to_folder':
        paramInput.hidden = false;
        paramInput.placeholder = 'folder name';
        paramInput.value = action.folder ?? '';
        break;
      case 'forward_to':
        paramInput.hidden = false;
        paramInput.placeholder = 'forward to (email)';
        paramInput.value = action.to ?? '';
        break;
      case 'os_notify':
        paramInput.hidden = false;
        paramInput.placeholder = 'notification text (optional)';
        paramInput.value = action.body ?? '';
        break;
      case 'run_scheduler_job':
        paramInput.hidden = false;
        paramInput.placeholder = 'scheduler job id';
        paramInput.value = action.jobId ?? '';
        break;
      default:
        paramInput.hidden = true;
        paramInput.value = '';
    }
  };

  const writeParam = () => {
    const v = paramInput.value.trim();
    if (action.type === 'move_to_folder') action.folder = v;
    else if (action.type === 'forward_to') action.to = v;
    else if (action.type === 'os_notify') action.body = v;
    else if (action.type === 'run_scheduler_job') action.jobId = v;
  };

  typeSelect.addEventListener('change', () => {
    delete action.folder;
    delete action.to;
    delete action.body;
    delete action.title;
    delete action.jobId;
    action.type = typeSelect.value as EmailAutomationActionType;
    syncParam();
  });
  paramInput.addEventListener('input', writeParam);

  const remove = el('button', 'email-btn email-btn-icon', '×') as HTMLButtonElement;
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove action');
  remove.addEventListener('click', () => {
    if (actions.length <= 1) return;
    const idx = actions.indexOf(action);
    if (idx >= 0) actions.splice(idx, 1);
    rowEl.remove();
  });

  syncParam();
  rowEl.appendChild(typeSelect);
  rowEl.appendChild(paramInput);
  rowEl.appendChild(remove);
  void container;
  return rowEl;
}
