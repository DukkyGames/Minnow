/**
 * Client-side workspace root — synced from /api/workspace when npm start is running.
 */

import { fetchWorkspace, type WorkspaceInfo, type WorkspaceRecentItem } from '../config/workspace-api';

let workspacePath = '';
let workspaceLabel = '';
let workspaceIsDefault = true;
let workspaceRecent: WorkspaceRecentItem[] = [];

/** Absolute path of the AI workspace folder. */
export function getWorkspacePath(): string {
  return workspacePath;
}

/** Folder basename for compact UI. */
export function getWorkspaceLabel(): string {
  return workspaceLabel;
}

/** True when workspace equals the Minnow app directory. */
export function isDefaultWorkspace(): boolean {
  return workspaceIsDefault;
}

function applyWorkspaceInfo(info: WorkspaceInfo): void {
  workspacePath = info.path ?? '';
  workspaceLabel = info.label ?? '';
  workspaceIsDefault = info.isDefault === true;
  if (Array.isArray(info.recent)) {
    workspaceRecent = info.recent;
  }
  if (info.scratchPath?.trim()) {
    void import('../state/sessions').then((m) =>
      m.migrateScratchWorkspacePathsForLoadedSession(info.scratchPath!.trim()),
    );
  }
}

/** MRU rows last seen from GET/PUT workspace (instant workspace menu paint). */
export function getWorkspaceRecentItems(): readonly WorkspaceRecentItem[] {
  return workspaceRecent;
}

/** Load workspace from server; leaves prior values if unavailable. */
export async function loadWorkspaceFromServer(): Promise<WorkspaceInfo | null> {
  const info = await fetchWorkspace();
  if (!info?.path) return null;
  applyWorkspaceInfo(info);
  return info;
}

/** Update in-memory workspace after a successful pick or PUT. */
export function setWorkspaceFromServer(info: WorkspaceInfo): void {
  applyWorkspaceInfo(info);
}

/** Test helper — reset module state. */
export function resetWorkspaceStateForTests(): void {
  workspacePath = '';
  workspaceLabel = '';
  workspaceIsDefault = true;
  workspaceRecent = [];
}
