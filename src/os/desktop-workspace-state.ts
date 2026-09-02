/**
 * Desktop workspace panel state — which right-edge tab is open.
 */

export type DesktopWorkspaceTab = 'files' | 'browser' | 'viewer';

export interface DesktopWorkspacePanelState {
  open: boolean;
  tab: DesktopWorkspaceTab;
}

const STORAGE_KEY = 'minnow.os.desktopWorkspacePanel';

const DEFAULT_STATE: DesktopWorkspacePanelState = {
  open: false,
  tab: 'files',
};

type Listener = (state: DesktopWorkspacePanelState) => void;

let panelState: DesktopWorkspacePanelState = loadPanelState();
const listeners = new Set<Listener>();

function loadPanelState(): DesktopWorkspacePanelState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<DesktopWorkspacePanelState>;
    const tab =
      parsed.tab === 'browser' || parsed.tab === 'viewer' || parsed.tab === 'files'
        ? parsed.tab
        : DEFAULT_STATE.tab;
    return { open: Boolean(parsed.open), tab };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function persistPanelState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panelState));
  } catch {}
}

function notifyListeners(): void {
  const snapshot = getDesktopWorkspacePanelState();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

/** Current panel open/tab state (copy). */
export function getDesktopWorkspacePanelState(): DesktopWorkspacePanelState {
  return { ...panelState };
}

/** True when a workspace drawer tab is expanded. */
export function isDesktopWorkspacePanelOpen(): boolean {
  return panelState.open;
}

/** Active tab when the panel is open. */
export function getDesktopWorkspaceTab(): DesktopWorkspaceTab {
  return panelState.tab;
}

/** Expand a tab (closes others implicitly — one drawer at a time). */
export function openDesktopWorkspaceTab(tab: DesktopWorkspaceTab): void {
  panelState = { open: true, tab };
  persistPanelState();
  notifyListeners();
}

/** Collapse the workspace drawer. */
export function collapseDesktopWorkspacePanel(): void {
  if (!panelState.open) return;
  panelState = { ...panelState, open: false };
  persistPanelState();
  notifyListeners();
}

/** Toggle drawer for a tab — same tab collapses, different tab switches. */
export function toggleDesktopWorkspaceTab(tab: DesktopWorkspaceTab): void {
  if (panelState.open && panelState.tab === tab) {
    collapseDesktopWorkspacePanel();
    return;
  }
  openDesktopWorkspaceTab(tab);
}

/** Subscribe to panel state changes. */
export function subscribeDesktopWorkspacePanel(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reset state (tests). */
export function resetDesktopWorkspacePanelForTests(): void {
  panelState = { ...DEFAULT_STATE };
  listeners.clear();
}
