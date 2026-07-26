/**
 * Settings → Issues — taxonomy CRUD for types, statuses, and priorities.
 */

import { appAlert, appConfirm, appPrompt } from './app-dialog';
import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import {
  countIssuesUsingTaxonomyId,
  createDefaultIssuesTaxonomy,
  ISSUE_STATUS_ROLES,
  slugifyTaxonomyLabel,
  sortedPriorities,
  sortedStatuses,
  sortedTypes,
  type IssuesTaxonomy,
  type StatusItem,
  type TaxonomyItem,
} from '../issues/taxonomy';
import { getIssuesSnapshot } from '../state/issues-store';
import {
  getIssuesTaxonomySync,
  saveIssuesTaxonomyNow,
  setIssuesTaxonomy,
} from '../state/issues-taxonomy-store';
import { appendSettingsGroup } from './settings-layout';
import { appendSettingsOfflineHint } from './settings-controls';
import { setStatus } from './status';

type TaxonomyKind = 'types' | 'statuses' | 'priorities';

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

function cloneTaxonomy(): IssuesTaxonomy {
  return structuredClone(getIssuesTaxonomySync());
}

async function persistTaxonomy(
  next: IssuesTaxonomy,
  okMessage = 'Issues taxonomy saved',
): Promise<boolean> {
  try {
    setIssuesTaxonomy(next);
    await saveIssuesTaxonomyNow();
    const mode = await detectConfigServer();
    setStatus(
      'ok',
      mode === 'server'
        ? okMessage
        : 'Saved locally — start npm start to persist to ~/.minnow',
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Save failed';
    setStatus('err', message);
    return false;
  }
}

function countInUse(kind: 'type' | 'status' | 'priority', id: string): number {
  const issues = getIssuesSnapshot()?.issues ?? [];
  return countIssuesUsingTaxonomyId(kind, id, issues);
}

function moveItem<T extends TaxonomyItem>(items: T[], id: string, delta: -1 | 1): T[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((item) => item.id === id);
  if (index < 0) return items;
  const swapIndex = index + delta;
  if (swapIndex < 0 || swapIndex >= sorted.length) return items;
  const next = sorted.map((item, i) => {
    if (i === index) return { ...item, order: swapIndex };
    if (i === swapIndex) return { ...item, order: index };
    return { ...item, order: i };
  });
  return next.sort((a, b) => a.order - b.order).map((item, i) => ({ ...item, order: i }));
}

function renderTaxonomyTable(
  mount: HTMLElement,
  kind: TaxonomyKind,
  title: string,
  hint: string,
  searchKey: string,
  onChange: () => void,
): void {
  const body = appendSettingsGroup(mount, title, hint, searchKey);
  const taxonomy = getIssuesTaxonomySync();
  const items =
    kind === 'types'
      ? sortedTypes(taxonomy)
      : kind === 'statuses'
        ? sortedStatuses(taxonomy)
        : sortedPriorities(taxonomy);

  const table = el('div', 'settings-issues-table');
  const head = el('div', 'settings-issues-table__head');
  head.append(
    el('span', undefined, 'Label'),
    el('span', undefined, 'Id'),
    kind === 'statuses' ? el('span', undefined, 'Role') : document.createComment(''),
    el('span', undefined, 'Order'),
    el('span', undefined, ''),
  );
  table.appendChild(head);

  const list = el('div', 'settings-issues-table__body');
  if (!items.length) {
    list.appendChild(el('p', 'settings-issues-empty', 'No items yet.'));
  }

  for (const item of items) {
    list.appendChild(renderTaxonomyRow(kind, item, onChange));
  }
  table.appendChild(list);

  const addRow = el('div', 'settings-issues-add');
  const addBtn = el('button', 'settings-inline-btn', `Add ${kind.slice(0, -1)}`);
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    void promptAndAddItem(kind, onChange);
  });
  addRow.appendChild(addBtn);
  body.append(table, addRow);
}

function renderTaxonomyRow(
  kind: TaxonomyKind,
  item: TaxonomyItem | StatusItem,
  onChange: () => void,
): HTMLElement {
  const row = el('div', 'settings-issues-row');
  row.dataset.taxonomyId = item.id;

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'settings-input';
  labelInput.value = item.label;
  labelInput.setAttribute('aria-label', `Label for ${item.id}`);
  labelInput.addEventListener('change', () => {
    void updateItemLabel(kind, item.id, labelInput.value.trim(), onChange);
  });

  const idCode = el('code', 'settings-issues-id', item.id);

  row.append(labelInput, idCode);

  if (kind === 'statuses') {
    const status = item as StatusItem;
    const roleSel = document.createElement('select');
    roleSel.className = 'settings-input settings-issues-role';
    roleSel.setAttribute('aria-label', `Role for ${item.id}`);
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '(none)';
    roleSel.appendChild(empty);
    for (const role of ISSUE_STATUS_ROLES) {
      const opt = document.createElement('option');
      opt.value = role;
      opt.textContent = role.replace(/_/g, ' ');
      roleSel.appendChild(opt);
    }
    roleSel.value = status.role ?? '';
    roleSel.addEventListener('change', () => {
      void updateStatusFlags(
        item.id,
        {
          role: roleSel.value ? (roleSel.value as StatusItem['role']) : undefined,
        },
        onChange,
      );
    });

    const flags = el('div', 'settings-issues-flags');
    const boardLabel = document.createElement('label');
    boardLabel.className = 'settings-issues-flag';
    const boardChk = document.createElement('input');
    boardChk.type = 'checkbox';
    boardChk.checked = status.boardVisible !== false;
    boardChk.setAttribute('aria-label', `Board column for ${item.id}`);
    boardLabel.append(boardChk, document.createTextNode(' Board'));
    boardChk.addEventListener('change', () => {
      void updateStatusFlags(item.id, { boardVisible: boardChk.checked }, onChange);
    });

    const closedLabel = document.createElement('label');
    closedLabel.className = 'settings-issues-flag';
    const closedChk = document.createElement('input');
    closedChk.type = 'checkbox';
    closedChk.checked = Boolean(status.isClosed);
    closedChk.setAttribute('aria-label', `Closed for ${item.id}`);
    closedLabel.append(closedChk, document.createTextNode(' Closed'));
    closedChk.addEventListener('change', () => {
      void updateStatusFlags(item.id, { isClosed: closedChk.checked }, onChange);
    });

    flags.append(boardLabel, closedLabel);
    row.append(roleSel, flags);
  } else {
    row.append(el('span'), el('span'));
  }

  const orderWrap = el('div', 'settings-issues-order');
  const upBtn = el('button', 'settings-icon-btn', '↑');
  upBtn.type = 'button';
  upBtn.title = 'Move up';
  upBtn.setAttribute('aria-label', `Move ${item.id} up`);
  upBtn.addEventListener('click', () => {
    void reorderItem(kind, item.id, -1, onChange);
  });
  const downBtn = el('button', 'settings-icon-btn', '↓');
  downBtn.type = 'button';
  downBtn.title = 'Move down';
  downBtn.setAttribute('aria-label', `Move ${item.id} down`);
  downBtn.addEventListener('click', () => {
    void reorderItem(kind, item.id, 1, onChange);
  });
  orderWrap.append(upBtn, downBtn);
  row.appendChild(orderWrap);

  const actions = el('div', 'settings-issues-actions');
  const delBtn = el('button', 'settings-inline-btn settings-inline-btn--danger', 'Delete');
  delBtn.type = 'button';
  delBtn.addEventListener('click', () => {
    void deleteItem(kind, item.id, onChange);
  });
  actions.appendChild(delBtn);
  row.appendChild(actions);

  return row;
}

async function updateItemLabel(
  kind: TaxonomyKind,
  id: string,
  label: string,
  onChange: () => void,
): Promise<void> {
  if (!label) {
    setStatus('err', 'Label cannot be empty');
    onChange();
    return;
  }
  const next = cloneTaxonomy();
  const list = kind === 'types' ? next.types : kind === 'statuses' ? next.statuses : next.priorities;
  const item = list.find((row) => row.id === id);
  if (!item) return;
  item.label = label;
  if (await persistTaxonomy(next)) onChange();
}

async function updateStatusFlags(
  id: string,
  patch: Partial<Pick<StatusItem, 'role' | 'isClosed' | 'boardVisible'>>,
  onChange: () => void,
): Promise<void> {
  const next = cloneTaxonomy();
  const status = next.statuses.find((row) => row.id === id);
  if (!status) return;
  if ('role' in patch) status.role = patch.role;
  if ('isClosed' in patch) status.isClosed = patch.isClosed;
  if ('boardVisible' in patch) status.boardVisible = patch.boardVisible;
  if (await persistTaxonomy(next)) onChange();
}

async function reorderItem(
  kind: TaxonomyKind,
  id: string,
  delta: -1 | 1,
  onChange: () => void,
): Promise<void> {
  const next = cloneTaxonomy();
  if (kind === 'types') next.types = moveItem(next.types, id, delta);
  else if (kind === 'statuses') next.statuses = moveItem(next.statuses, id, delta);
  else next.priorities = moveItem(next.priorities, id, delta);
  if (await persistTaxonomy(next)) onChange();
}

async function deleteItem(
  kind: TaxonomyKind,
  id: string,
  onChange: () => void,
): Promise<void> {
  const useKind = kind === 'types' ? 'type' : kind === 'statuses' ? 'status' : 'priority';
  const inUse = countInUse(useKind, id);
  if (inUse > 0) {
    await appAlert(`Used by ${inUse} issue${inUse === 1 ? '' : 's'} — reassign first.`, 'Cannot delete');
    return;
  }
  const ok = await appConfirm(`Remove "${id}" from ${kind}?`, {
    confirmLabel: 'Delete',
    title: 'Delete taxonomy item',
  });
  if (!ok) return;

  const next = cloneTaxonomy();
  if (kind === 'types') next.types = next.types.filter((row) => row.id !== id);
  else if (kind === 'statuses') next.statuses = next.statuses.filter((row) => row.id !== id);
  else next.priorities = next.priorities.filter((row) => row.id !== id);

  if (next.types.length === 0 || next.statuses.length === 0 || next.priorities.length === 0) {
    setStatus('err', 'Each list must keep at least one item');
    return;
  }

  if (await persistTaxonomy(next, 'Item removed')) onChange();
}

async function promptAndAddItem(kind: TaxonomyKind, onChange: () => void): Promise<void> {
  const label = await appPrompt(`Label for new ${kind.slice(0, -1)}`, '', {
    title: `Add ${kind.slice(0, -1)}`,
    placeholder: 'e.g. Spike',
  });
  if (!label?.trim()) return;

  let id = slugifyTaxonomyLabel(label);
  if (!id) {
    setStatus('err', 'Could not derive an id from that label');
    return;
  }

  const next = cloneTaxonomy();
  const list = kind === 'types' ? next.types : kind === 'statuses' ? next.statuses : next.priorities;
  if (list.some((row) => row.id === id)) {
    const custom = await appPrompt('Id already exists. Enter a unique id', `${id}_2`, {
      title: 'Duplicate id',
    });
    if (!custom?.trim()) return;
    id = custom.trim();
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      setStatus('err', 'Id must match [a-z][a-z0-9_]*');
      return;
    }
    if (list.some((row) => row.id === id)) {
      setStatus('err', 'That id is also taken');
      return;
    }
  }

  const order = list.length;
  if (kind === 'statuses') {
    next.statuses.push({ id, label: label.trim(), order, boardVisible: true });
  } else if (kind === 'types') {
    next.types.push({ id, label: label.trim(), order });
  } else {
    next.priorities.push({ id, label: label.trim(), order });
  }

  if (await persistTaxonomy(next, 'Item added')) onChange();
}

/** Render Issues taxonomy settings into the mount node. */
export function renderIssuesSettingsSection(mount: HTMLElement): void {
  mount.replaceChildren();

  if (!isServerStorageMode()) {
    appendSettingsOfflineHint(
      mount,
      'Issues taxonomy is saved in this browser. Run <code>npm start</code> to persist under <code>~/.minnow/issues/taxonomy.json</code>.',
    );
  } else {
    mount.appendChild(
      el(
        'p',
        'settings-section-note',
        'Customize issue types, workflow statuses, and priorities. Status roles power agent workflows and board columns.',
      ),
    );
  }

  const refresh = (): void => {
    mount.replaceChildren();
    if (!isServerStorageMode()) {
      appendSettingsOfflineHint(
        mount,
        'Issues taxonomy is saved in this browser. Run <code>npm start</code> to persist under <code>~/.minnow/issues/taxonomy.json</code>.',
      );
    } else {
      mount.appendChild(
        el(
          'p',
          'settings-section-note',
          'Customize issue types, workflow statuses, and priorities. Status roles power agent workflows and board columns.',
        ),
      );
    }

    renderTaxonomyTable(
      mount,
      'types',
      'Types',
      'Bug, task, idea, note, or your own kinds.',
      'apps.issues.types',
      refresh,
    );
    renderTaxonomyTable(
      mount,
      'statuses',
      'Statuses',
      'Assign workflow roles so agents know which column means triage, in progress, review, and done.',
      'apps.issues.statuses',
      refresh,
    );
    renderTaxonomyTable(
      mount,
      'priorities',
      'Priorities',
      'Urgency levels for sorting and filters.',
      'apps.issues.priorities',
      refresh,
    );

    const resetRow = el('div', 'settings-issues-reset');
    const resetBtn = el('button', 'settings-inline-btn', 'Restore defaults');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => {
      void (async () => {
        const ok = await appConfirm(
          'Restore the built-in types, statuses, and priorities? Existing issues keep their current values.',
          { confirmLabel: 'Restore', title: 'Restore defaults' },
        );
        if (!ok) return;
        if (await persistTaxonomy(createDefaultIssuesTaxonomy(), 'Defaults restored')) {
          refresh();
        }
      })();
    });
    resetRow.appendChild(resetBtn);
    mount.appendChild(resetRow);
  };

  refresh();
}
