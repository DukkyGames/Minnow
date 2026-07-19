/**
 * One-shot CDP element resolution at a guest (x, y) point.
 *
 * Shared with the Design Mode pick session (`preview-cdp-pick.ts`): both paths fetch the same
 * DOM/CSS payload and adapt it via `adaptCdpRawPick`. The context-menu "Send to chat" path
 * attaches briefly, resolves, then detaches — unlike the persistent pick session.
 */

import type { WebContents } from 'electron';
import { adaptCdpRawPick, type CdpPickedElement } from './preview-cdp-adapt.js';

/** Minimal shape of the Electron `Debugger` API this module drives. */
export interface DebuggerLike {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(method: string, commandParams?: Record<string, unknown>): Promise<any>;
}

export type ResolveElementAtPointResult =
  | { ok: true; picked: CdpPickedElement }
  | { ok: false; error: string };

/**
 * Fetch DOM/CSS details for a backend node and adapt to the shared pick shape.
 * Caller owns debugger attach/detach and document priming.
 */
export async function fetchCdpNodeAsPicked(
  dbg: DebuggerLike,
  backendNodeId: number,
  uid: number,
): Promise<CdpPickedElement | null> {
  const dprEval = await dbg.sendCommand('Runtime.evaluate', {
    expression: 'window.devicePixelRatio',
  });
  const devicePixelRatio =
    typeof dprEval?.result?.value === 'number' && dprEval.result.value > 0
      ? dprEval.result.value
      : 1;

  const boxModelResult = await dbg.sendCommand('DOM.getBoxModel', { backendNodeId });
  if (!boxModelResult?.model?.content) {
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

  // Stamp data-mn-uid so region-capture / re-query can find the node (best-effort).
  if (nodeId) {
    await dbg
      .sendCommand('DOM.setAttributeValue', {
        nodeId,
        name: 'data-mn-uid',
        value: String(uid),
      })
      .catch(() => {
        /* picking still works without the persisted uid attribute */
      });
  }

  return adaptCdpRawPick(
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
}

export interface ResolveElementAtPointOptions {
  /**
   * When true, refuse to attach/use CDP if a Design Mode pick session already owns the debugger.
   * Prevents tearing down an armed Select overlay mid-pick.
   */
  pickSessionActive?: boolean;
  /** Stable uid stamped onto the node (defaults to 1 for one-shot resolves). */
  uid?: number;
}

/**
 * Resolve the topmost element under guest CSS coordinates `(x, y)`.
 * Attaches CDP when needed; detaches only when this call performed the attach.
 */
export async function resolveElementAtPoint(
  wc: WebContents,
  x: number,
  y: number,
  options: ResolveElementAtPointOptions = {},
): Promise<ResolveElementAtPointResult> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'Invalid coordinates for element resolve' };
  }
  if (options.pickSessionActive) {
    return {
      ok: false,
      error: 'Element resolve unavailable while Design Mode Select is active',
    };
  }

  const dbg = wc.debugger as unknown as DebuggerLike;
  const attachedBefore = dbg.isAttached();
  let attachedByUs = false;

  try {
    if (!attachedBefore) {
      dbg.attach('1.3');
      attachedByUs = true;
    }

    await dbg.sendCommand('DOM.enable');
    await dbg.sendCommand('CSS.enable');
    await dbg.sendCommand('Runtime.enable');

    // DOM agent needs a document fetch before backendNodeId resolution works.
    try {
      await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    } catch {
      /* guest mid-navigation — getNodeForLocation may still succeed after enable */
    }

    const located = await dbg.sendCommand('DOM.getNodeForLocation', {
      x: Math.round(x),
      y: Math.round(y),
      includeUserAgentShadowDOM: true,
    });
    const backendNodeId = located?.backendNodeId;
    if (typeof backendNodeId !== 'number') {
      return { ok: false, error: 'No element at that location' };
    }

    const uid = options.uid ?? 1;
    const picked = await fetchCdpNodeAsPicked(dbg, backendNodeId, uid);
    if (!picked) {
      return { ok: false, error: 'Picked node has no box model (non-rendered element)' };
    }
    return { ok: true, picked };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    // Only detach when we attached — leave DevTools / other owners alone.
    if (attachedByUs && dbg.isAttached()) {
      try {
        dbg.detach();
      } catch {
        /* already detached */
      }
    }
  }
}
