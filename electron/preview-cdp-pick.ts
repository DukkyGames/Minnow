import type { WebContents } from 'electron';
import type { CdpPickedElement } from './preview-cdp-adapt.js';
import { fetchCdpNodeAsPicked, type DebuggerLike } from './preview-cdp-element-at-point.js';

export interface CdpPickSession {
  disable(): Promise<void>;
}

const HIGHLIGHT_CONFIG = {
  contentColor: { r: 158, g: 197, b: 167, a: 0.35 },
  showInfo: true,
};

const SELECTION_OUTLINE_COLOR = '#9ec5a7';

function markSelectedScript(uid: number): string {
  return `(() => {
    const el = document.querySelector('[data-mn-uid=${JSON.stringify(String(uid))}]');
    if (!el) return false;
    el.setAttribute('data-mn-selected', '');
    el.style.setProperty('outline', '2px solid ${SELECTION_OUTLINE_COLOR}', 'important');
    el.style.setProperty('outline-offset', '1px', 'important');
    return true;
  })()`;
}

const CLEAR_SELECTION_SCRIPT = `(() => {
  document.querySelectorAll('[data-mn-selected]').forEach((el) => {
    el.removeAttribute('data-mn-selected');
    el.style.removeProperty('outline');
    el.style.removeProperty('outline-offset');
  });
  return true;
})()`;

interface PickDebuggerLike extends DebuggerLike {
  on(event: 'message', listener: (event: unknown, method: string, params: any) => void): unknown;
  removeListener(event: 'message', listener: (...args: unknown[]) => void): unknown;
}

// Prime the DOM tree, then re-arm inspect mode after every click.
export async function enableCdpPicking(
  wc: WebContents,
  onPick: (picked: CdpPickedElement) => void,
  onError?: (message: string) => void,
): Promise<CdpPickSession> {
  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) {
    throw new Error('Preview guest is not available');
  }
  const dbg = wc.debugger as unknown as PickDebuggerLike;
  if (!dbg.isAttached()) {
    dbg.attach('1.3');
  }

  await dbg.sendCommand('DOM.enable');
  await dbg.sendCommand('CSS.enable');
  await dbg.sendCommand('Overlay.enable');
  await dbg.sendCommand('Runtime.enable');

  const requestDocument = async (): Promise<void> => {
    try {
      await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    } catch {
    }
  };
  await requestDocument();

  let disabled = false;
  const armInspectMode = async (): Promise<void> => {
    if (disabled) return;
    try {
      await dbg.sendCommand('Overlay.setInspectMode', {
        mode: 'searchForNode',
        highlightConfig: HIGHLIGHT_CONFIG,
      });
    } catch {
    }
  };
  await armInspectMode();

  let nextUid = 1;

  const showSelectionHighlight = async (uid: number): Promise<void> => {
    if (disabled) return;
    try {
      await dbg.sendCommand('Runtime.evaluate', { expression: markSelectedScript(uid) });
    } catch {
    }
  };

  async function handleInspectNode(backendNodeId: number): Promise<number | null> {
    try {
      const uid = nextUid;
      nextUid += 1;
      const picked = await fetchCdpNodeAsPicked(dbg, backendNodeId, uid);
      if (!picked) {
        onError?.('picked node has no box model (non-rendered element)');
        return null;
      }
      onPick(picked);
      return uid;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onError?.(message);
      return null;
    }
  }

  const onInspect = async (backendNodeId: number): Promise<void> => {
    const uid = await handleInspectNode(backendNodeId);
    await armInspectMode();
    if (uid != null) await showSelectionHighlight(uid);
  };

  const messageHandler = (_event: unknown, method: string, params: any) => {
    if (method === 'Overlay.inspectNodeRequested' && typeof params?.backendNodeId === 'number') {
      void onInspect(params.backendNodeId);
    } else if (method === 'DOM.documentUpdated') {
      void requestDocument();
    }
  };
  dbg.on('message', messageHandler);

  return {
    async disable(): Promise<void> {
      disabled = true;
      dbg.removeListener('message', messageHandler as (...args: unknown[]) => void);
      if (wc.isDestroyed()) return;
      try {
        await dbg.sendCommand('Overlay.setInspectMode', {
          mode: 'none',
          highlightConfig: {},
        });
        await dbg.sendCommand('Overlay.hideHighlight');
        await dbg.sendCommand('Runtime.evaluate', { expression: CLEAR_SELECTION_SCRIPT });
      } catch {
      }
      if (wc.isDestroyed()) return;
      if (dbg.isAttached()) {
        try {
          dbg.detach();
        } catch {
        }
      }
    },
  };
}
