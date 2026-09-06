/**
 * Workspace picker for the new-issue form when Issues scope is "all workspaces".
 */

import {
  fetchWorkspace,
  type WorkspaceInfo,
  type WorkspaceRecentItem,
} from '../config/workspace-api';
import { normalizeWorkspacePath, workspacePathsEqual } from '../lib/normalize-workspace-path';
import {
  getWorkspaceLabel,
  getWorkspacePath,
  getWorkspaceRecentItems,
  setWorkspaceFromServer,
} from '../state/workspace';

export type NewIssueWorkspaceOption = {
  path: string;
  label: string;
};

/** One row in the new-issue workspace `<select>`. */
export function buildNewIssueWorkspaceOptions(
  info: Pick<WorkspaceInfo, 'recent' | 'sandbox' | 'scratchPath'> | null,
  recentFallback: readonly WorkspaceRecentItem[] = [],
): NewIssueWorkspaceOption[] {
  const options: NewIssueWorkspaceOption[] = [];
  const seen = new Set<string>();

  const add = (path: string, label: string): void => {
    const key = normalizeWorkspacePath(path);
    if (!key || seen.has(key)) return;
    seen.add(key);
    options.push({ path: key, label: label.trim() || key });
  };

  const sandbox = info?.sandbox;
  if (sandbox?.path?.trim()) {
    add(sandbox.path, sandbox.label || 'Scratch');
  } else if (info?.scratchPath?.trim()) {
    add(info.scratchPath.trim(), 'Scratch');
  }

  const recent = info?.recent ?? [...recentFallback];
  for (const item of recent) {
    if (!item.exists) continue;
    add(item.path, item.label);
  }

  const current = getWorkspacePath();
  if (current.trim()) {
    add(current, getWorkspaceLabel() || 'Current workspace');
  }

  return options;
}

/** Insert the workspace field into an existing or new new-issue form. */
export function ensureNewIssueWorkspaceField(form: HTMLElement): void {
  if (document.getElementById('issuesNewWorkspaceWrap')) return;

  const grid = form.querySelector('.issues-new-form__grid');
  const title = form.querySelector('.issues-new-form__title');
  if (!grid || !title) return;

  const wrap = document.createElement('label');
  wrap.id = 'issuesNewWorkspaceWrap';
  wrap.className = 'issues-new-form__workspace';
  wrap.hidden = true;

  const workspaceLabel = document.createElement('span');
  workspaceLabel.textContent = 'Workspace';

  const select = document.createElement('select');
  select.id = 'issuesNewWorkspace';
  select.setAttribute('aria-label', 'Workspace');

  wrap.append(workspaceLabel, select);
  title.insertAdjacentElement('afterend', wrap);
}

function paintWorkspaceSelect(
  select: HTMLSelectElement,
  options: NewIssueWorkspaceOption[],
  preferredPath: string,
): void {
  const prev = select.value;
  select.replaceChildren();
  for (const item of options) {
    const opt = document.createElement('option');
    opt.value = item.path;
    opt.textContent = item.label;
    select.appendChild(opt);
  }

  const paths = options.map((o) => o.path);
  const preferred = normalizeWorkspacePath(preferredPath);
  if (prev && paths.some((p) => workspacePathsEqual(p, prev))) {
    select.value = paths.find((p) => workspacePathsEqual(p, prev)) ?? paths[0] ?? '';
  } else if (preferred && paths.some((p) => workspacePathsEqual(p, preferred))) {
    select.value = paths.find((p) => workspacePathsEqual(p, preferred)) ?? paths[0] ?? '';
  } else if (paths[0]) {
    select.value = paths[0];
  }
}

/** Show or hide the workspace field and refresh its options from the server MRU. */
export async function refreshNewIssueWorkspaceField(
  scope: 'all' | 'current_workspace',
): Promise<void> {
  const form = document.getElementById('issuesNewForm');
  if (!form) return;
  ensureNewIssueWorkspaceField(form);

  const wrap = document.getElementById('issuesNewWorkspaceWrap');
  const select = document.getElementById('issuesNewWorkspace');
  if (!(wrap instanceof HTMLLabelElement) || !(select instanceof HTMLSelectElement)) return;

  const show = scope === 'all';
  wrap.hidden = !show;
  if (!show) return;

  const cached = getWorkspaceRecentItems();
  paintWorkspaceSelect(select, buildNewIssueWorkspaceOptions(null, cached), getWorkspacePath());

  const info = await fetchWorkspace();
  if (info) {
    setWorkspaceFromServer(info);
    paintWorkspaceSelect(
      select,
      buildNewIssueWorkspaceOptions(info, cached),
      getWorkspacePath(),
    );
  }
}

/** Target workspace for a new issue — current folder unless all-workspaces scope picks another. */
export function getNewIssueWorkspacePath(scope: 'all' | 'current_workspace'): string {
  if (scope !== 'all') return getWorkspacePath();

  const wrap = document.getElementById('issuesNewWorkspaceWrap');
  const select = document.getElementById('issuesNewWorkspace');
  if (wrap?.hidden || !(select instanceof HTMLSelectElement) || !select.value.trim()) {
    return getWorkspacePath();
  }
  return normalizeWorkspacePath(select.value);
}
