/**
 * CDP-backed element picking for cross-origin preview guests (MIN-370 P7).
 *
 * `execJs` script injection is undesirable/blocked on arbitrary external sites (CSP, sandboxing).
 * This attaches Chrome DevTools Protocol directly to the guest `WebContents` — hover highlight via
 * `Overlay.setInspectMode`, node geometry via `DOM.getBoxModel`, computed styles via
 * `CSS.getComputedStyleForNode` — with no script ever injected into the page. Only reachable from
 * the Electron main process; the iframe fallback keeps its existing coordinate-only degradation.
 *
 * Isolated on purpose: nothing else in preview-host.ts depends on this module, so a CDP
 * regression can't take down the rest of the preview channel.
 */

import type { WebContents } from 'electron';
import { adaptCdpRawPick, type CdpPickedElement } from './preview-cdp-adapt.js';

export interface CdpPickSession {
  disable(): Promise<void>;
}

const HIGHLIGHT_CONFIG = {
  contentColor: { r: 158, g: 197, b: 167, a: 0.35 },
  showInfo: true,
};

/** App accent (#9ec5a7) — matches the same-origin picker's in-guest hover outline. */
const SELECTION_OUTLINE_COLOR = '#9ec5a7';

/**
 * Persistent "selected" indicator, drawn into the page itself rather than via the CDP Overlay
 * layer. On a cross-origin guest the DOM SVG overlay markers are occluded by the native
 * WebContentsView, and a CDP `Overlay.highlightNode` is cleared the moment `searchForNode` inspect
 * mode redraws on hover — so neither is visible. Marking the element with a real CSS outline via
 * CSSOM paints on top of page content, persists across hovers, accumulates for multi-select, and
 * is CSP-safe (programmatic `.style` writes are not governed by `style-src`). Keyed off the
 * `data-mn-uid` the pick already stamps on the node.
 */
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

/** Undo every {@link markSelectedScript} outline when the session ends. */
const CLEAR_SELECTION_SCRIPT = `(() => {
  document.querySelectorAll('[data-mn-selected]').forEach((el) => {
    el.removeAttribute('data-mn-selected');
    el.style.removeProperty('outline');
    el.style.removeProperty('outline-offset');
  });
  return true;
})()`;

/** Minimal shape of the Electron `Debugger` API this module drives. */
interface DebuggerLike {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(method: string, commandParams?: Record<string, unknown>): Promise<any>;
  on(event: 'message', listener: (event: unknown, method: string, params: any) => void): unknown;
  removeListener(event: 'message', listener: (...args: unknown[]) => void): unknown;
}

/**
 * Attach CDP to `wc` and start native hover/click element picking. Resolves once the inspect
 * overlay is armed; `onPick` fires (possibly many times) as the user clicks elements; `onError`
 * fires for non-fatal per-pick failures (the session stays alive).
 */
export async function enableCdpPicking(
  wc: WebContents,
  onPick: (picked: CdpPickedElement) => void,
  onError?: (message: string) => void,
): Promise<CdpPickSession> {
  const dbg = wc.debugger as unknown as DebuggerLike;
  if (!dbg.isAttached()) {
    dbg.attach('1.3');
  }

  await dbg.sendCommand('DOM.enable');
  await dbg.sendCommand('CSS.enable');
  await dbg.sendCommand('Overlay.enable');
  await dbg.sendCommand('Runtime.enable');

  // The DOM agent rejects backendNodeId resolution (DOM.getBoxModel /
  // DOM.pushNodesByBackendIdsToFrontend) with "Document needs to be requested first" until the
  // tree has been fetched once. Overlay hover highlighting works without it, so the failure only
  // surfaces on the first click. Prime it now, and re-prime whenever the document is invalidated
  // (full navigation, or an SPA route swap that fires DOM.documentUpdated).
  const requestDocument = async (): Promise<void> => {
    try {
      await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    } catch {
      /* guest mid-navigation — the next inspect/documentUpdated re-primes it */
    }
  };
  await requestDocument();

  // `searchForNode` is one-shot: Chromium drops back to `mode: 'none'` after each click, so the
  // Select tool (which stays armed for repeated picks) would go dead after the first element.
  // Re-arm it at enable and after every pick.
  let disabled = false;
  const armInspectMode = async (): Promise<void> => {
    if (disabled) return; // a pick's .finally() must not re-arm after the session was torn down
    try {
      await dbg.sendCommand('Overlay.setInspectMode', {
        mode: 'searchForNode',
        highlightConfig: HIGHLIGHT_CONFIG,
      });
    } catch {
      /* guest may be gone or the session tearing down */
    }
  };
  await armInspectMode();

  let nextUid = 1;

  const showSelectionHighlight = async (uid: number): Promise<void> => {
    if (disabled) return;
    try {
      await dbg.sendCommand('Runtime.evaluate', { expression: markSelectedScript(uid) });
    } catch {
      /* node gone / guest navigated — the missing outline is non-fatal */
    }
  };

  /** Resolve + forward a clicked node. Returns the pick's uid, or null when nothing was picked. */
  async function handleInspectNode(backendNodeId: number): Promise<number | null> {
    try {
      const dprEval = await dbg.sendCommand('Runtime.evaluate', {
        expression: 'window.devicePixelRatio',
      });
      const devicePixelRatio =
        typeof dprEval?.result?.value === 'number' && dprEval.result.value > 0
          ? dprEval.result.value
          : 1;

      const boxModelResult = await dbg.sendCommand('DOM.getBoxModel', { backendNodeId });
      if (!boxModelResult?.model?.content) {
        onError?.('picked node has no box model (non-rendered element)');
        return null;
      }

      const pushed = await dbg.sendCommand('DOM.pushNodesByBackendIdsToFrontend', {
        backendNodeIds: [backendNodeId],
      });
      const nodeId = pushed?.nodeIds?.[0];

      const described = await dbg.sendCommand('DOM.describeNode', { backendNodeId });
      const outerHtmlResult = await dbg
        .sendCommand('DOM.getOuterHTML', { backendNodeId })
        .catch(() => ({ outerHTML: '' }));
      const computedStyleResult = nodeId
        ? await dbg
            .sendCommand('CSS.getComputedStyleForNode', { nodeId })
            .catch(() => ({ computedStyle: [] }))
        : { computedStyle: [] };

      const uid = nextUid;
      nextUid += 1;
      if (nodeId) {
        await dbg
          .sendCommand('DOM.setAttributeValue', {
            nodeId,
            name: 'data-mn-uid',
            value: String(uid),
          })
          .catch(() => {
            /* best-effort — picking still works without the persisted uid attribute */
          });
      }

      const picked = adaptCdpRawPick(
        {
          attributes: described?.node?.attributes,
          nodeName: described?.node?.nodeName ?? 'element',
          localName: described?.node?.localName,
          boxModel: boxModelResult.model,
          outerHTML: outerHtmlResult?.outerHTML ?? '',
          computedStyle: computedStyleResult?.computedStyle ?? [],
          devicePixelRatio,
          shiftKey: false,
        },
        uid,
      );
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
    // Re-arm inspect mode so the next element is still selectable, then outline the just-picked
    // node in-page so there's a visible "selected" confirmation (the CDP overlay/DOM-marker layers
    // are both invisible on a cross-origin native guest).
    await armInspectMode();
    if (uid != null) await showSelectionHighlight(uid);
  };

  const messageHandler = (_event: unknown, method: string, params: any) => {
    if (method === 'Overlay.inspectNodeRequested' && typeof params?.backendNodeId === 'number') {
      void onInspect(params.backendNodeId);
    } else if (method === 'DOM.documentUpdated') {
      // The frontend node cache was invalidated (navigation / SPA route swap). Re-request the
      // tree so the next click can still resolve its backendNodeId.
      void requestDocument();
    }
  };
  dbg.on('message', messageHandler);

  return {
    async disable(): Promise<void> {
      disabled = true;
      try {
        await dbg.sendCommand('Overlay.setInspectMode', {
          mode: 'none',
          highlightConfig: {},
        });
        await dbg.sendCommand('Overlay.hideHighlight');
        // Strip the in-page selection outlines we painted so the guest is left clean.
        await dbg.sendCommand('Runtime.evaluate', { expression: CLEAR_SELECTION_SCRIPT });
      } catch {
        /* guest may already be gone */
      }
      dbg.removeListener('message', messageHandler as (...args: unknown[]) => void);
      if (dbg.isAttached()) {
        try {
          dbg.detach();
        } catch {
          /* already detached by Electron (e.g. devtools opened) */
        }
      }
    },
  };
}
