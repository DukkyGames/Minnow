/**
 * Live thought bubbles during reasoning streams and a per-message "Thoughts" panel
 * after the assistant reply completes.
 */

import { scrollBottom } from './input';
import { splitThinkingSegments } from '../api/reasoning';

/** Milliseconds between typewriter steps when catching up long text. */
const TYPEWRITER_STEP_MS = 28;
/** Max characters to reveal per tick (keeps long thoughts responsive). */
const TYPEWRITER_CHARS_PER_TICK = 4;
/** How long a completed thought stays fully visible before fading into the next one. */
const THOUGHT_GAP_MS = 1000;

/** Optional hooks so the parent row can sync stream-status labels with reasoning. */
export interface ThoughtPhaseCallbacks {
  onThinkingStart?: () => void;
  onReasoningEnded?: () => void;
}

/**
 * Controller for one user send: one live bubble at a time, paragraph boundaries
 * finalize a thought; `endReasoningPhase` flushes the open segment when prose starts.
 */
export class ThoughtBubbleController {
  /** Segments finalized by `\n\n` or by `endReasoningPhase` / `flushOpen`. */
  private finalizedSegments: string[] = [];

  /** Current open reasoning fragment (no trailing `\n\n` yet). */
  private openBuffer = '';

  /** Assistant `.msg` row that owns the live stage (updates on new tool-loop bubbles). */
  private assistantWrap: HTMLElement;

  private stageEl: HTMLDivElement | null = null;

  private bubbleEl: HTMLDivElement | null = null;

  private textEl: HTMLSpanElement | null = null;

  private cursorEl: HTMLSpanElement | null = null;

  private typeTimer: ReturnType<typeof setInterval> | null = null;

  /** Holds the inter-thought pause; cleared on `abort`. */
  private gapTimer: ReturnType<typeof setTimeout> | null = null;

  /** Serializes “show full thought → gap → fade” so rapid `\n\n` splits stay ordered. */
  private tailWork: Promise<void> = Promise.resolve();

  private displayedLen = 0;

  private disposed = false;

  private phaseCallbacks: ThoughtPhaseCallbacks;

  private thinkingStartNotified = false;

  constructor(assistantWrap: HTMLElement, phaseCallbacks: ThoughtPhaseCallbacks = {}) {
    this.assistantWrap = assistantWrap;
    this.phaseCallbacks = phaseCallbacks;
  }

  /**
   * Point the controller at the active assistant row (e.g. after a tool round
   * replaces the streaming bubble wrapper).
   */
  /** Reset phase callbacks for a new streaming shell in the same user send (e.g. after tools). */
  resetStreamPhaseHints(): void {
    this.thinkingStartNotified = false;
  }

  setAssistantWrap(wrap: HTMLElement): void {
    this.assistantWrap = wrap;
    if (this.stageEl && !this.stageEl.isConnected) {
      this.stageEl = null;
      this.bubbleEl = null;
      this.textEl = null;
      this.cursorEl = null;
      this.stopTypewriter();
      this.displayedLen = 0;
    }
  }

  /**
   * Append full reasoning from a non-streaming completion (no live bubble replay).
   */
  ingestCompletedReasoning(text: string): void {
    if (this.disposed || !text.trim()) return;
    const segs = splitThinkingSegments(text);
    if (segs.length > 0) {
      this.finalizedSegments.push(...segs);
    } else {
      this.finalizedSegments.push(text.trim());
    }
  }

  /** If a thought-gap timer is running, invoking this ends the hold early (fade + chain advance). */
  private gapSkipResolve: (() => void) | null = null;

  /** Append streamed reasoning characters; splits on `\n\n` into discrete thoughts. */
  appendReasoningDelta(delta: string): void {
    if (this.disposed || !delta) return;
    if (!this.thinkingStartNotified) {
      this.thinkingStartNotified = true;
      this.phaseCallbacks.onThinkingStart?.();
    }
    this.tailWork = this.tailWork.then(() => this.applyReasoningDeltaInQueue(delta));
  }

  /**
   * Applies one SSE reasoning fragment after any prior work (gaps, earlier deltas).
   * Returned promise completes when carry typing may resume (after paragraph holds).
   */
  private applyReasoningDeltaInQueue(delta: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.openBuffer += delta;
    const parts = this.openBuffer.split(/\n\n+/);
    if (parts.length === 1) {
      if (this.openBuffer) {
        this.ensureLiveBubble();
        this.scheduleTypewriter();
      }
      this.scrollChat();
      return Promise.resolve();
    }

    const carry = parts.pop() ?? '';
    this.stopTypewriter();
    for (let i = 0; i < parts.length; i += 1) {
      const seg = parts[i]!.trim();
      if (seg) this.finalizeSegmentFromBoundary(seg);
    }
    this.openBuffer = carry;
    this.displayedLen = 0;
    return this.tailWork.then(() => {
      if (this.disposed) return;
      if (this.openBuffer) {
        this.ensureLiveBubble();
        this.scheduleTypewriter();
      }
      this.scrollChat();
    });
  }

  /**
   * Call when the model starts streaming normal `content` for this phase:
   * flushes any open reasoning, removes the live stage from the DOM.
   * Ends any active inter-thought hold immediately so prose can replace reasoning.
   */
  endReasoningPhase(): void {
    if (this.disposed) return;
    this.gapSkipResolve?.();
    const tail = this.openBuffer.trim();
    this.openBuffer = '';
    if (tail) {
      this.finalizedSegments.push(tail);
    }
    this.stopTypewriter();
    this.teardownStage();
    this.displayedLen = 0;
    this.phaseCallbacks.onReasoningEnded?.();
  }

  /** Drop timers and remove the live stage (abort / error / new send). */
  abort(): void {
    this.disposed = true;
    this.gapSkipResolve?.();
    this.gapSkipResolve = null;
    if (this.gapTimer != null) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    this.stopTypewriter();
    this.teardownStage();
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
    const raw = this.getSegments().join('\n\n');
    return splitThinkingSegments(raw);
  }

  /**
   * Close one paragraph-delimited thought: persist it, show the full text briefly,
   * wait {@link THOUGHT_GAP_MS}, then fade out so the next thought can appear.
   */
  private finalizeSegmentFromBoundary(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.finalizedSegments.push(trimmed);
    this.tailWork = this.tailWork.then(
      () =>
        new Promise<void>((resolve) => {
          if (this.disposed) {
            resolve();
            return;
          }
          this.stopTypewriter();
          this.ensureLiveBubble();
          if (this.textEl) {
            this.textEl.textContent = trimmed;
          }

          const endGap = (): void => {
            if (settled) return;
            settled = true;
            if (this.gapTimer != null) {
              clearTimeout(this.gapTimer);
              this.gapTimer = null;
            }
            this.gapSkipResolve = null;
            if (!this.disposed) {
              this.fadeOutAndRemoveBubble();
              this.bubbleEl = null;
              this.textEl = null;
              this.cursorEl = null;
              this.displayedLen = 0;
            }
            resolve();
          };

          let settled = false;
          this.gapSkipResolve = endGap;
          this.gapTimer = setTimeout(endGap, THOUGHT_GAP_MS);
        }),
    );
  }

  private ensureLiveBubble(): void {
    if (this.disposed) return;
    if (this.stageEl && !this.stageEl.isConnected) {
      this.stageEl = null;
      this.bubbleEl = null;
      this.textEl = null;
      this.cursorEl = null;
    }
    if (!this.stageEl) {
      const stage = document.createElement('div');
      stage.className = 'thought-stage';
      stage.setAttribute('aria-live', 'polite');
      stage.setAttribute('aria-label', 'Model reasoning');
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
    }

    if (!this.bubbleEl && this.stageEl) {
      const b = document.createElement('div');
      b.className = 'thought-bubble';
      const span = document.createElement('span');
      span.className = 'thought-bubble-text';
      const cur = document.createElement('span');
      cur.className = 'thought-cursor';
      cur.setAttribute('aria-hidden', 'true');
      b.appendChild(span);
      b.appendChild(cur);
      this.stageEl.appendChild(b);
      this.bubbleEl = b;
      this.textEl = span;
      this.cursorEl = cur;
    }
  }

  private fadeOutAndRemoveBubble(): void {
    const b = this.bubbleEl;
    if (!b) return;
    b.classList.add('thought-fade-out');
    const remove = (): void => {
      b.removeEventListener('animationend', remove);
      b.remove();
    };
    b.addEventListener('animationend', remove);
  }

  private teardownStage(): void {
    this.stopTypewriter();
    if (this.stageEl) {
      this.stageEl.remove();
      this.stageEl = null;
    }
    this.bubbleEl = null;
    this.textEl = null;
    this.cursorEl = null;
  }

  private stopTypewriter(): void {
    if (this.typeTimer != null) {
      clearInterval(this.typeTimer);
      this.typeTimer = null;
    }
  }

  private scheduleTypewriter(): void {
    if (this.disposed || !this.textEl) return;
    const target = this.openBuffer;
    if (this.typeTimer != null) return;
    this.typeTimer = setInterval(() => {
      if (this.disposed || !this.textEl) {
        this.stopTypewriter();
        return;
      }
      const t = this.openBuffer;
      if (this.displayedLen >= t.length) {
        this.stopTypewriter();
        return;
      }
      this.displayedLen = Math.min(
        t.length,
        this.displayedLen + TYPEWRITER_CHARS_PER_TICK,
      );
      this.textEl.textContent = t.slice(0, this.displayedLen);
      this.scrollChat();
    }, TYPEWRITER_STEP_MS);
  }

  private scrollChat(): void {
    scrollBottom();
  }
}

/**
 * Renders the "Thoughts" control and expandable flow above the assistant bubble.
 * Skips when there are no segments. Idempotent if already present.
 */
export function renderThoughtsToggle(
  wrap: HTMLElement,
  segments: string[],
  expanded = false,
): void {
  const normalized = splitThinkingSegments(segments.join('\n\n'));
  const list = normalized.length > 0 ? normalized : segments.filter((s) => s.trim());
  if (list.length === 0) return;
  if (wrap.querySelector('.thoughts-panel-wrap')) return;

  const panelWrap = document.createElement('div');
  panelWrap.className = 'thoughts-panel-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'thoughts-toggle';
  btn.textContent = 'Thoughts';
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');

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
    flow.hidden = !flow.hidden;
    btn.setAttribute('aria-expanded', flow.hidden ? 'false' : 'true');
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
