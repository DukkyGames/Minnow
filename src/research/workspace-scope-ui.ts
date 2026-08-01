/**
 * Deep Research workspace picker — shown when scope includes the local codebase.
 */

import { fetchWorkspace, type WorkspaceInfo } from '../config/workspace-api';
import { getLocalServerAvailable } from '../tools/client';
import { setStatus } from '../ui/status';
import { openWorkspaceFolderPicker } from '../ui/workspace-folder-picker';
import type { ResearchScope } from './types';

/** Whether the selected research scope searches the local codebase. */
export function scopeIncludesCodebase(scope: ResearchScope): boolean {
  return scope === 'codebase' || scope === 'both';
}

/** Display name for a workspace path in the research picker. */
export function researchWorkspaceBasename(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[A-Za-z]:$/.test(normalized)) {
    return `${normalized.toUpperCase()}\\`;
  }
  const parts = normalized.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (last) {
    return last;
  }
  return absPath || 'Folder';
}

/** Ensure a workspace path is selectable and selected in the research workspace list. */
export function ensureResearchWorkspaceOption(
  select: HTMLSelectElement,
  absPath: string,
  label?: string,
): void {
  const path = absPath.trim();
  if (!path) {
    return;
  }
  const existing = [...select.options].find((option) => option.value === path);
  if (existing) {
    select.value = path;
    return;
  }
  const opt = document.createElement('option');
  opt.value = path;
  opt.textContent = label?.trim() || researchWorkspaceBasename(path);
  opt.selected = true;
  select.appendChild(opt);
  select.value = path;
}

/** Populate a workspace <select> from the server workspace MRU list. */
export function populateResearchWorkspaceSelect(
  select: HTMLSelectElement,
  info: WorkspaceInfo | null,
): void {
  const selectedPath = select.value?.trim();
  select.replaceChildren();
  const recent = info?.recent?.filter((item) => item.exists) ?? [];
  if (recent.length > 0) {
    for (const item of recent) {
      const opt = document.createElement('option');
      opt.value = item.path;
      opt.textContent = item.label;
      if (item.isCurrent && !selectedPath) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
    if (selectedPath) {
      ensureResearchWorkspaceOption(select, selectedPath);
    }
    return;
  }

  if (info?.path?.trim()) {
    const path = info.path.trim();
    if (selectedPath && selectedPath !== path) {
      ensureResearchWorkspaceOption(select, selectedPath);
      ensureResearchWorkspaceOption(select, path, info.label);
      return;
    }
    const opt = document.createElement('option');
    opt.value = path;
    opt.textContent = info.label || path;
    opt.selected = true;
    select.appendChild(opt);
    return;
  }

  if (selectedPath) {
    ensureResearchWorkspaceOption(select, selectedPath);
  }
}

/** Load recent workspaces into the select (no-op when the element is missing). */
export async function refreshResearchWorkspaceSelect(
  select: HTMLSelectElement | null,
): Promise<void> {
  if (!select) {
    return;
  }
  const info = await fetchWorkspace();
  populateResearchWorkspaceSelect(select, info);
}

/** Open the in-app folder browser and apply the chosen path to the select. */
export async function browseResearchWorkspace(
  select: HTMLSelectElement | null,
): Promise<string | null> {
  if (!select) {
    return null;
  }
  if (!getLocalServerAvailable()) {
    setStatus('err', 'Workspace browse requires Minnow running locally');
    return null;
  }

  const initialPath = select.value?.trim() || undefined;
  const result = await openWorkspaceFolderPicker({ initialPath });
  if (result.cancelled || !result.path) {
    return null;
  }

  ensureResearchWorkspaceOption(select, result.path);
  setStatus('ok', `Research workspace: ${researchWorkspaceBasename(result.path)}`);
  return result.path;
}

/** Show or hide the workspace field based on research scope. */
export function syncResearchWorkspaceFieldVisibility(
  scope: ResearchScope,
  field: HTMLElement | null,
): void {
  if (!field) {
    return;
  }
  const show = scopeIncludesCodebase(scope);
  field.toggleAttribute('hidden', !show);
  field.classList.toggle('hidden', !show);
  field.setAttribute('aria-hidden', show ? 'false' : 'true');
}

/** Read the workspace path to send with a research start request. */
export function readResearchWorkspaceRoot(
  select: HTMLSelectElement | null,
  scope: ResearchScope,
): string | undefined {
  if (!scopeIncludesCodebase(scope)) {
    return undefined;
  }
  const value = select?.value?.trim();
  return value || undefined;
}

/** Wire scope ↔ workspace visibility, MRU list, and folder browse. */
export function wireResearchWorkspaceScopeControls(options: {
  scopeSelect: HTMLSelectElement;
  workspaceField: HTMLElement;
  workspaceSelect: HTMLSelectElement;
  browseBtn?: HTMLButtonElement | null;
}): void {
  const { scopeSelect, workspaceField, workspaceSelect, browseBtn } = options;

  const syncVisibility = (): void => {
    const scope = (scopeSelect.value ?? 'web') as ResearchScope;
    syncResearchWorkspaceFieldVisibility(scope, workspaceField);
  };

  scopeSelect.addEventListener('change', syncVisibility);
  browseBtn?.addEventListener('click', () => {
    void browseResearchWorkspace(workspaceSelect);
  });
  void refreshResearchWorkspaceSelect(workspaceSelect);
  syncVisibility();
}
