/**
 * Collapsible reasoning UI: collapsed "Thinking…" indicator while streaming,
 * expand-to-read full prose; per-message toggle after the assistant reply completes.
 */

import { resolveChatMount } from './chat-mount';
import { splitThinkingSegments } from '../api/reasoning';
import { formatThinkingDuration } from './thinking-duration';

/** Label shown on the live collapsed thinking row. */
const LIVE_THINKING_LABEL = 'Thinking…';

/** Optional hooks so the parent row can sync stream-status labels with reasoning. */
export interface ThoughtPhaseCallbacks {
  onThinkingStart?: () => void;
  onReasoningEnded?: () => void;
}

/**
 * Controller for one user send: accumulates reasoning internally, shows a compact
 * collapsed indicator by default, and reveals prose only when the user expands.
 */
export class ThoughtBubbleController {
  /** Segments finalized by `\n\n` or by `endReasoningPhase` / `flushOpen`. */
  private finalizedSegments: string[] = [];

  /** Current open reasoning fragment (no trailing `\n\n` yet). */
  private openBuffer = '';

  /** Assistant `.msg` row that owns the live stage (updates on new tool-loop bubbles). */
  private assistantWrap: HTMLElement;

  private stageEl: HTMLDivElement | null = null;

  private toggleBtn: HTMLButtonElement | null = null;

  private caretEl: HTMLSpanElement | null = null;

  private flowEl: HTMLDivElement | null = null;

  private flowTextEl: HTMLPreElement | null = null;

  /** User-expanded state for the live reasoning row (collapsed by default). */
  private expanded = false;

  /** Wall-clock reasoning duration shown on the live toggle when available. */
  private elapsedMs: number | null = null;

  private disposed = false;

  private phaseCallbacks: ThoughtPhaseCallbacks;

  private thinkingStartNotified = false;

  /** True after `endReasoningPhase` fires `onReasoningEnded` for the current stream. */
  private reasoningPhaseEnded = false;

  /** Anthropic thinking signature for the current reasoning block (tool-loop replay). */
  private anthropicThinkingSignature: string | null = null;

  /** Cached joined segment text; cleared when reasoning text changes. */
  private joinedDisplayCache: string | null = null;

  constructor(assistantWrap: HTMLElement, phaseCallbacks: ThoughtPhaseCallbacks = {}) {
    this.assistantWrap = assistantWrap;
    this.phaseCallbacks = phaseCallbacks;
  }

  /** Reset phase callbacks for a new streaming shell in the same user send (e.g. after tools). */
  resetStreamPhaseHints(): void {
    this.thinkingStartNotified = false;
    this.reasoningPhaseEnded = false;
    this.anthropicThinkingSignature = null;
  }

  /**
   * Point the controller at the active assistant row (e.g. after a tool round
   * replaces the streaming bubble wrapper).
   */
  setAssistantWrap(wrap: HTMLElement): void {
    this.assistantWrap = wrap;
    if (this.stageEl && !this.stageEl.isConnected) {
      this.teardownStage();
    }
  }

  /** Update the muted elapsed suffix on the live collapsed row. */
  setThinkingElapsed(ms: number | null): void {
    if (this.disposed) return;
    this.elapsedMs = ms != null && ms > 0 ? ms : null;
    this.updateToggleLabel();
  }

  /**
   * Append full reasoning from a non-streaming completion (no live bubble replay).
   */
  ingestCompletedReasoning(text: string): void {
    if (this.disposed || !text.trim()) return;
    this.invalidateJoinedDisplayCache();
    const segs = splitThinkingSegments(text);
    if (segs.length > 0) {
      this.finalizedSegments.push(...segs);
    } else {
      this.finalizedSegments.push(text.trim());
    }
  }

  /** Append streamed reasoning characters; splits on `\n\n` into discrete thoughts.
   * Follow-scroll is owned by `createChatTurnEventPainter` (MIN-729), not here.
   */
  appendReasoningDelta(delta: string): void {
    if (this.disposed || !delta) return;
    this.invalidateJoinedDisplayCache();
    if (!this.thinkingStartNotified) {
      this.thinkingStartNotified = true;
      this.phaseCallbacks.onThinkingStart?.();
    }

    this.openBuffer += delta;
    const parts = this.openBuffer.split(/\n\n+/);
    if (parts.length > 1) {
      const carry = parts.pop() ?? '';
      for (const part of parts) {
        const seg = part.trim();
        if (seg) {
          this.finalizedSegments.push(seg);
        }
      }
      this.openBuffer = carry;
    }

    this.ensureThinkingPanel();
    this.syncFlowContent();
    // Stream follow-scroll is owned by createChatTurnEventPainter (MIN-729) so a
    // thinking burst is one layout per paint tick, not one per delta.
  }

  /** Store Anthropic signature_delta for replay on later tool-loop turns. */
  appendReasoningSignature(signature: string): void {
    const trimmed = signature.trim();
    if (this.disposed || !trimmed) return;
    this.anthropicThinkingSignature = trimmed;
  }

  /** Signature captured during this assistant turn (if any). */
  getAnthropicThinkingSignature(): string | undefined {
    return this.anthropicThinkingSignature?.trim() || undefined;
  }

  /**
   * Call when the model starts streaming normal `content` for this phase:
   * flushes any open reasoning, removes the live stage from the DOM.
   */
  endReasoningPhase(): void {
    if (this.disposed || this.reasoningPhaseEnded) return;
    this.reasoningPhaseEnded = true;
    const tail = this.openBuffer.trim();
    this.openBuffer = '';
    if (tail) {
      this.finalizedSegments.push(tail);
    }
    this.invalidateJoinedDisplayCache();
    this.teardownStage();
    this.phaseCallbacks.onReasoningEnded?.();
  }

  /** Drop timers and remove the live stage (abort / error / new send). */
  abort(): void {
    this.disposed = true;
    this.teardownStage();
  }

  /** Ordered segments joined for streaming overlays and context usage (cached). */
  getJoinedDisplayText(): string {
    if (this.joinedDisplayCache !== null) {
      return this.joinedDisplayCache;
    }
    this.joinedDisplayCache = this.getSegments().join('\n\n');
    return this.joinedDisplayCache;
  }

  /** Ordered segments for persistence (flushes open buffer first). */
  getSegments(): string[] {
    const tail = this.openBuffer.trim();
    const copy = [...this.finalizedSegments];
    if (tail) copy.push(tail);
    return copy;
  }

  /** Merge `getSegments()` into normalized paragraph segments for storage. */
  getSegmentsNormalized(): string[] {
    const raw = this.getJoinedDisplayText();
    return splitThinkingSegments(raw);
  }

  /**
   * Return reasoning segments for a completed assistant row, then reset so the next
   * stream in the same user send does not duplicate thoughts on a later message.
   */
  consumePersistedSegments(): string[] {
    const segments = this.getSegmentsNormalized();
    this.finalizedSegments = [];
    this.openBuffer = '';
    this.invalidateJoinedDisplayCache();
    this.teardownStage();
    this.thinkingStartNotified = false;
    this.reasoningPhaseEnded = false;
    this.expanded = false;
    this.elapsedMs = null;
    return segments;
  }

  /** Await hook retained for tests (no async queue in collapsed UI). */
  flushPendingWork(): Promise<void> {
    return Promise.resolve();
  }

  private invalidateJoinedDisplayCache(): void {
    this.joinedDisplayCache = null;
  }

  private getDisplayText(): string {
    return this.getJoinedDisplayText();
  }

  private ensureThinkingPanel(): void {
    if (this.disposed) return;
    if (this.stageEl && !this.stageEl.isConnected) {
      this.stageEl = null;
      this.toggleBtn = null;
      this.caretEl = null;
      this.flowEl = null;
      this.flowTextEl = null;
    }

    if (!this.stageEl) {
      const stage = document.createElement('div');
      stage.className = 'thought-stage';

      const panelWrap = document.createElement('div');
      panelWrap.className = 'thoughts-panel-wrap thoughts-panel-wrap--live';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thoughts-toggle thoughts-toggle--live';
      btn.setAttribute('aria-expanded', 'false');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'thoughts-toggle__label';
      labelSpan.textContent = LIVE_THINKING_LABEL;

      const caret = document.createElement('span');
      caret.className = 'thoughts-caret thoughts-caret--pulse';
      caret.setAttribute('aria-hidden', 'true');

      btn.appendChild(labelSpan);
      btn.appendChild(caret);

      const flow = document.createElement('div');
      flow.className = 'thoughts-flow';
      flow.hidden = true;
      flow.id = `thoughts-flow-live-${Math.random().toString(36).slice(2, 9)}`;
      btn.setAttribute('aria-controls', flow.id);

      const pre = document.createElement('pre');
      pre.className = 'thoughts-segment';
      flow.appendChild(pre);

      btn.addEventListener('click', () => {
        this.expanded = !this.expanded;
        this.syncExpandedState();
      });

      panelWrap.appendChild(btn);
      panelWrap.appendChild(flow);
      stage.appendChild(panelWrap);

      const label = this.assistantWrap.querySelector('.msg-label');
      const firstBubble = this.assistantWrap.querySelector('.msg-bubble');
      if (firstBubble && firstBubble.parentElement === this.assistantWrap) {
        this.assistantWrap.insertBefore(stage, firstBubble);
      } else if (label) {
        label.insertAdjacentElement('afterend', stage);
      } else {
        this.assistantWrap.prepend(stage);
      }

      this.stageEl = stage;
      this.toggleBtn = btn;
      this.caretEl = caret;
      this.flowEl = flow;
      this.flowTextEl = pre;

      // Live thinking row owns the indicator; hide the generic stream-status row.
      const streamStatus = this.assistantWrap.querySelector('.stream-status');
      streamStatus?.classList.add('hidden');

      this.updateToggleLabel();
      this.syncExpandedState();
    }
  }

  private syncExpandedState(): void {
    if (!this.toggleBtn || !this.flowEl || !this.caretEl) return;
    this.flowEl.hidden = !this.expanded;
    this.toggleBtn.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
    this.caretEl.classList.toggle('thoughts-caret--expanded', this.expanded);
    this.caretEl.classList.toggle('thoughts-caret--pulse', !this.expanded);
    syncThoughtsCaretPulse(thoughtsScopeFromEl(this.caretEl));
    if (this.expanded) {
      this.syncFlowContent();
    }
  }

  private syncFlowContent(): void {
    if (!this.expanded || !this.flowTextEl) return;
    this.flowTextEl.textContent = this.getDisplayText();
  }

  private updateToggleLabel(): void {
    if (!this.toggleBtn) return;
    const labelEl = this.toggleBtn.querySelector('.thoughts-toggle__label');
    if (!labelEl) return;

    let label = LIVE_THINKING_LABEL;
    if (this.elapsedMs != null && this.elapsedMs > 0) {
      label = `${LIVE_THINKING_LABEL} ${formatThinkingDuration(this.elapsedMs)}`;
    }
    labelEl.textContent = label;
    this.toggleBtn.setAttribute('aria-label', this.expanded ? 'Hide reasoning' : 'Show reasoning');
  }

  private teardownStage(): void {
    if (this.stageEl) {
      this.stageEl.remove();
      this.stageEl = null;
    }
    this.toggleBtn = null;
    this.caretEl = null;
    this.flowEl = null;
    this.flowTextEl = null;
    this.expanded = false;
  }
}

/**
 * Resolve the mount that holds the `.msg` rows owning `el` (the element whose
 * children are the message rows). Returns null when `el` is not inside a `.msg`.
 */
export function thoughtsScopeFromEl(el: HTMLElement): HTMLElement | null {
  return el.closest('.msg')?.parentElement ?? null;
}

/**
 * Enforce the single-pulse invariant: at most one `.thoughts-caret` animates —
 * always the most recent in DOM order (the live "Thinking…" stage while
 * reasoning is active, otherwise the newest settled "Thought for" toggle).
 * Expanded carets never pulse.
 *
 * `scope` is the mount holding the `.msg` rows; when null it falls back to the
 * active chat mount.
 */
export function syncThoughtsCaretPulse(scope: HTMLElement | null): void {
  const root = scope ?? resolveChatMount();
  if (!root) return;
  const carets = Array.from(root.querySelectorAll('.thoughts-caret'));
  for (const caret of carets) {
    caret.classList.remove('thoughts-caret--pulse');
  }
  const last = carets[carets.length - 1];
  if (last && !last.classList.contains('thoughts-caret--expanded')) {
    last.classList.add('thoughts-caret--pulse');
  }
}

/**
 * Renders the "Thoughts" control and expandable flow above the assistant bubble.
 * Skips when there are no segments. Idempotent if already present.
 */
export interface ThoughtsToggleOptions {
  expanded?: boolean;
  durationMs?: number;
  /**
   * Whether the collapsed caret pulses. Defaults to false — settled "Thought for
   * X.Xs" toggles stay static; only the current reasoning indicator animates.
   */
  pulse?: boolean;
}

export function renderThoughtsToggle(
  wrap: HTMLElement,
  segments: string[],
  opts: ThoughtsToggleOptions | boolean = {},
): void {
  const resolved = typeof opts === 'boolean' ? { expanded: opts } : opts;
  const expanded = resolved.expanded ?? false;
  const normalized = splitThinkingSegments(segments.join('\n\n'));
  const list = normalized.length > 0 ? normalized : segments.filter((s) => s.trim());
  if (list.length === 0) return;
  if (wrap.querySelector('.thoughts-panel-wrap')) return;

  const panelWrap = document.createElement('div');
  panelWrap.className = 'thoughts-panel-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'thoughts-toggle';
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');

  const labelSpan = document.createElement('span');
  labelSpan.className = 'thoughts-toggle__label';

  const durationMs = resolved.durationMs;
  if (durationMs != null && durationMs > 0) {
    const label = `Thought for ${formatThinkingDuration(durationMs)}`;
    labelSpan.textContent = label;
    btn.setAttribute('aria-label', expanded ? 'Hide reasoning' : label);
  } else {
    labelSpan.textContent = 'Thoughts';
    btn.setAttribute('aria-label', expanded ? 'Hide reasoning' : 'Show model reasoning thoughts');
  }

  const caret = document.createElement('span');
  caret.className = 'thoughts-caret';
  if (expanded) {
    caret.classList.add('thoughts-caret--expanded');
  } else if (resolved.pulse === true) {
    caret.classList.add('thoughts-caret--pulse');
  }
  caret.setAttribute('aria-hidden', 'true');

  btn.appendChild(labelSpan);
  btn.appendChild(caret);

  const flow = document.createElement('div');
  flow.className = 'thoughts-flow';
  flow.id = `thoughts-flow-${Math.random().toString(36).slice(2, 9)}`;
  flow.hidden = !expanded;
  btn.setAttribute('aria-controls', flow.id);

  for (const seg of list) {
    const pre = document.createElement('pre');
    pre.className = 'thoughts-segment';
    pre.textContent = seg;
    flow.appendChild(pre);
  }

  btn.addEventListener('click', () => {
    const nowExpanded = Boolean(flow.hidden);
    flow.hidden = !nowExpanded;
    btn.setAttribute('aria-expanded', nowExpanded ? 'true' : 'false');
    caret.classList.toggle('thoughts-caret--expanded', nowExpanded);
    syncThoughtsCaretPulse(thoughtsScopeFromEl(caret));
    const currentLabel = labelSpan.textContent ?? 'Thoughts';
    btn.setAttribute(
      'aria-label',
      nowExpanded ? 'Hide reasoning' : currentLabel,
    );
  });

  panelWrap.appendChild(btn);
  panelWrap.appendChild(flow);

  const bubble = wrap.querySelector('.msg-bubble');
  if (bubble) {
    wrap.insertBefore(panelWrap, bubble);
  } else {
    wrap.appendChild(panelWrap);
  }
}
