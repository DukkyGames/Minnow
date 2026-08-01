/**
 * Browser tool: open a workspace file in Minnow's Code editor and select a line range.
 *
 * This is a *view* action, not a write one: it moves the student's editor to the
 * code being discussed and highlights the lines. Nothing on disk changes, which is
 * why Education Mode keeps it — pointing at code is the tutor's main affordance
 * once pasting the answer is off the table.
 *
 * Opening is fire-and-forget in the viewer (content loads on the next render), so
 * this waits for the tab to settle before answering. A tool that says "look at
 * line 40" while the pane shows a load error is worse than one that reports the
 * error: the model has no way to notice it guessed the path wrong.
 *
 * Both dependencies are injected so the rule stays testable without a DOM.
 */

/** Selects `startLine`..`endLine` (1-based, inclusive) once the file is loaded. */
export interface EditorLineRange {
  startLine: number;
  endLine: number;
}

/** Outcome of the viewer's own load for an open tab. */
export interface EditorTabStatus {
  status: 'ready' | 'loading' | 'error' | 'missing';
  error?: string;
}

export interface OpenInEditorDeps {
  openFile: (relativePath: string, range?: EditorLineRange) => Promise<void>;
  /** Current load state of the viewer tab for `relativePath`. */
  readTabStatus: (relativePath: string) => EditorTabStatus;
  /** Injected in tests to skip real waiting. */
  delay?: (ms: number) => Promise<void>;
}

/** How long to wait for the viewer to finish loading before answering anyway. */
const LOAD_SETTLE_TIMEOUT_MS = 3_000;
const LOAD_POLL_MS = 60;
/** Bounded by attempts, not wall clock, so an injected no-op delay ends the loop. */
const MAX_LOAD_POLLS = Math.ceil(LOAD_SETTLE_TIMEOUT_MS / LOAD_POLL_MS);

/** Default opener: the same viewer path a code-reference chip click takes. */
async function openViaFileViewer(
  relativePath: string,
  range?: EditorLineRange,
): Promise<void> {
  const { openFileInViewer } = await import('../ui/file-viewer');
  await openFileInViewer(relativePath, range ? { initialLineRange: range } : undefined);
}

/** Default status reader: the viewer's own tab store. */
function readViewerTabStatus(relativePath: string): EditorTabStatus {
  const store = getLoadedTabStore();
  if (!store) return { status: 'ready' };
  const tab = store.getViewerTab(relativePath);
  if (!tab) return { status: 'missing' };
  if (tab.loadStatus === 'error') {
    return { status: 'error', error: tab.loadError };
  }
  return { status: tab.loadStatus === 'loading' ? 'loading' : 'ready' };
}

type TabStoreModule = {
  getViewerTab: (path: string) => { loadStatus: string; loadError?: string } | undefined;
};

/**
 * Imported once before the open, then read synchronously while polling. The
 * import stays dynamic so the UI never lands in headless tool bundles, and stays
 * cached so each poll is a plain function call rather than a module resolution.
 */
let tabStoreModule: TabStoreModule | null = null;

async function primeEditorTabStore(): Promise<void> {
  if (tabStoreModule) return;
  tabStoreModule = (await import('../ui/file-viewer-tab-store')) as TabStoreModule;
}

function getLoadedTabStore(): TabStoreModule | null {
  return tabStoreModule;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 1-based positive integer, or null when the value is absent/unusable. */
function lineArg(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const line = Math.trunc(n);
  return line >= 1 ? line : null;
}

/** Poll the viewer until the tab leaves `loading`, or the timeout expires. */
async function waitForTabToSettle(
  path: string,
  deps: Required<Pick<OpenInEditorDeps, 'readTabStatus'>> & { delay: (ms: number) => Promise<void> },
): Promise<EditorTabStatus> {
  let status = deps.readTabStatus(path);
  for (let poll = 0; poll < MAX_LOAD_POLLS && status.status === 'loading'; poll += 1) {
    await deps.delay(LOAD_POLL_MS);
    status = deps.readTabStatus(path);
  }
  return status;
}

/** Open a file in the Code editor; returns a human-readable result string. */
export async function toolOpenInEditor(
  args: Record<string, unknown>,
  deps: Partial<OpenInEditorDeps> = {},
): Promise<string> {
  const rawPath = args.path;
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return 'Error: "path" is required (workspace-relative file path)';
  }
  const path = rawPath.trim().replace(/\\/g, '/');

  const hasStart = args.start_line != null && args.start_line !== '';
  const hasEnd = args.end_line != null && args.end_line !== '';
  const startLine = lineArg(args.start_line);
  const endLine = lineArg(args.end_line);

  if (hasStart && startLine === null) {
    return 'Error: "start_line" must be a positive integer (1-based line number)';
  }
  if (hasEnd && endLine === null) {
    return 'Error: "end_line" must be a positive integer (1-based line number)';
  }
  if (!hasStart && hasEnd) {
    return 'Error: "end_line" needs "start_line" — pass both to highlight a range';
  }

  const range =
    startLine === null
      ? undefined
      : { startLine, endLine: Math.max(startLine, endLine ?? startLine) };

  const openFile = deps.openFile ?? openViaFileViewer;
  const readTabStatus = deps.readTabStatus ?? readViewerTabStatus;
  const delay = deps.delay ?? sleep;

  if (!deps.readTabStatus) {
    await primeEditorTabStore();
  }
  await openFile(path, range);

  const settled = await waitForTabToSettle(path, { readTabStatus, delay });
  if (settled.status === 'error') {
    const detail = settled.error?.trim();
    return `Error: could not open ${path} in the editor${detail ? ` (${detail})` : ''}. Check the path against the workspace the user has open.`;
  }

  const where = range
    ? ` and highlighted ${
        range.startLine === range.endLine
          ? `line ${range.startLine}`
          : `lines ${range.startLine}-${range.endLine}`
      }`
    : '';
  const tail =
    settled.status === 'loading'
      ? ' It is still loading.'
      : ' The user can see it now — refer to the lines instead of pasting them.';
  return `Opened ${path} in the Code editor${where}.${tail}`;
}
