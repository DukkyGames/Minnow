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
  await dbg.sendCommand('Overlay.setInspectMode', {
    mode: 'searchForNode',
    highlightConfig: HIGHLIGHT_CONFIG,
  });

  let nextUid = 1;

  async function handleInspectNode(backendNodeId: number): Promise<void> {
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
        return;
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onError?.(message);
    }
  }

  const messageHandler = (_event: unknown, method: string, params: any) => {
    if (method === 'Overlay.inspectNodeRequested' && typeof params?.backendNodeId === 'number') {
      void handleInspectNode(params.backendNodeId);
    }
  };
  dbg.on('message', messageHandler);

  return {
    async disable(): Promise<void> {
      try {
        await dbg.sendCommand('Overlay.setInspectMode', {
          mode: 'none',
          highlightConfig: {},
        });
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
