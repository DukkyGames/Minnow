import type { WebContents } from 'electron';
import { adaptCdpRawPick, type CdpPickedElement } from './preview-cdp-adapt.js';

export interface DebuggerLike {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(method: string, commandParams?: Record<string, unknown>): Promise<any>;
}

export type ResolveElementAtPointResult =
  | { ok: true; picked: CdpPickedElement }
  | { ok: false; error: string };

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

  if (nodeId) {
    await dbg
      .sendCommand('DOM.setAttributeValue', {
        nodeId,
        name: 'data-mn-uid',
        value: String(uid),
      })
      .catch(() => {
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
  pickSessionActive?: boolean;
  uid?: number;
}

// Detach only when this call attached; leave DevTools and other owners alone.
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

    try {
      await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    } catch {
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
    if (attachedByUs && dbg.isAttached()) {
      try {
        dbg.detach();
      } catch {
      }
    }
  }
}
