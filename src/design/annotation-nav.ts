/**
 * Bidirectional annotation <-> chat navigation (MIN-368).
 *
 * - {@link jumpToChatTurn}: page → transcript. Reuses the existing chat-switch
 *   (`activateChatById`) + re-render (`renderChatFromHistory`) plumbing, then scrolls to the
 *   `[data-history-index]` row messages.ts/message-actions.ts already stamp on every rendered
 *   message — the same identity used for edit/regenerate/branch actions.
 * - {@link openAnnotationOnPage}: transcript → page. Opens the preview at the annotation's page,
 *   enables Design Mode for it, and pulses the surviving anchor (or reports it dead so the
 *   caller can render a moved/removed badge).
 */

import { activateChatById, getActiveChat } from '../state/sessions';
import { gatherAnchorCandidates } from './design-tool';
import { getDesignModeSession } from './design-mode';
import { isAnchorDead, loadPageAnnotations } from './annotation-store';

const JUMP_PULSE_CLASS = 'mn-design-jump-pulse';
const GUEST_SETTLE_MS = 250;

/** Switch to a chat (if needed) and scroll its transcript to a specific turn (history index). */
export function jumpToChatTurn(chatId: string, turnId: string): void {
  const pulseRow = (): void => {
    const el = document.querySelector(`[data-history-index="${cssEscapeLocal(turnId)}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add(JUMP_PULSE_CLASS);
    window.setTimeout(() => el.classList.remove(JUMP_PULSE_CLASS), 1600);
  };

  if (getActiveChat().id !== chatId) {
    // Await history hydrate so the jump target exists in the DOM after paint.
    void activateChatById(chatId).then(() =>
      import('../ui/messages').then((m) => {
        m.renderChatFromHistory(getActiveChat());
        window.requestAnimationFrame(pulseRow);
      }),
    );
    return;
  }
  pulseRow();
}

function cssEscapeLocal(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/([.#:[\]"'\\])/g, '\\$1');
}

export interface OpenAnnotationTarget {
  shapeId?: string;
  pinId?: string;
}

export type OpenAnnotationStatus = 'resolved' | 'dead' | 'unavailable';

/**
 * Open the page an annotation lives on, enable Design Mode, and either pulse the surviving
 * anchor (`resolved`) or report it can't be found on the live page anymore (`dead` — uid AND
 * selector both failed; `unavailable` — the annotation itself is gone, e.g. erased).
 */
export async function openAnnotationOnPage(
  pageUrl: string,
  target: OpenAnnotationTarget,
): Promise<OpenAnnotationStatus> {
  const { openPreviewPageAndEnableDesignMode, WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID } =
    await import('../ui/preview-panel');
  await openPreviewPageAndEnableDesignMode(pageUrl);

  // Give the guest a beat to finish navigating before reading its tagged elements.
  await new Promise((resolve) => window.setTimeout(resolve, GUEST_SETTLE_MS));

  const [data, candidates] = await Promise.all([
    loadPageAnnotations(pageUrl),
    gatherAnchorCandidates(),
  ]);

  const session = getDesignModeSession(WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID);
  if (!session) return 'unavailable';

  if (target.shapeId) {
    const shape = data.shapes.find((s) => s.id === target.shapeId);
    if (!shape) return 'unavailable';
    session.overlay.renderShapes(data.shapes, (shapeId) => {
      const linked = data.shapes.find((s) => s.id === shapeId);
      const link = linked?.links?.[0];
      if (link) jumpToChatTurn(link.chatId, link.turnId);
    });
    if (isAnchorDead(shape.anchor, candidates)) return 'dead';
    session.overlay.pulseShapeIds([shape.id]);
    return 'resolved';
  }

  if (target.pinId) {
    const pin = data.pins.find((p) => p.id === target.pinId);
    if (!pin) return 'unavailable';
    session.overlay.renderPins(data.pins);
    if (isAnchorDead(pin.anchor, candidates)) return 'dead';
    session.overlay.pulsePinIds([pin.id]);
    return 'resolved';
  }

  return 'unavailable';
}
