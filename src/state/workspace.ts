/**
 * Client-side workspace root — synced from /api/workspace when npm start is running.
 */

import { fetchWorkspace, type WorkspaceInfo } from '../config/workspace-api';

let workspacePath = '';
let workspaceLabel = '';
let workspaceIsDefault = true;

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
}
