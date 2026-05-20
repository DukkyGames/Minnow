/**
 * Live stream phase labels (generating / thinking) shown beside the assistant row
 * until the prose bubble is revealed.
 */

import { formatThinkingDuration } from './thinking-duration';

export type StreamPhase = 'generating' | 'thinking' | 'prose' | 'done';

/** Visible while waiting for reasoning or prose (no tokens yet). */
export const STREAM_LABEL_GENERATING = 'Generating response…';

/** Visible while reasoning SSE is active (thought bubbles are primary). */
export const STREAM_LABEL_THINKING = 'Thinking…';

const LABEL_BY_PHASE: Record<'generating' | 'thinking', string> = {
  generating: STREAM_LABEL_GENERATING,
  thinking: STREAM_LABEL_THINKING,
};

export interface StreamingStatusHandle {
  setPhase(phase: StreamPhase): void;
  /** Muted elapsed suffix while phase is `thinking`; pass null to clear. */
  setThinkingElapsed(ms: number | null): void;
  dispose(): void;
}

/**
 * Inserts a status row after the assistant label; caller owns the parent `wrap`.
 */
export function attachStreamStatus(wrap: HTMLElement): StreamingStatusHandle {
  const statusEl = document.createElement('div');
  statusEl.className = 'stream-status stream-status--generating';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.setAttribute('aria-busy', 'true');

  const dots = document.createElement('span');
  dots.className = 'stream-status__dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'stream-status__dot';
    dots.appendChild(dot);
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'stream-status__label';
  labelEl.textContent = STREAM_LABEL_GENERATING;

  const elapsedEl = document.createElement('span');
  elapsedEl.className = 'stream-status__elapsed';
  elapsedEl.hidden = true;

  statusEl.appendChild(dots);
  statusEl.appendChild(labelEl);
  statusEl.appendChild(elapsedEl);

  const label = wrap.querySelector('.msg-label');
  const bubble = wrap.querySelector('.msg-bubble');
  if (bubble && bubble.parentElement === wrap) {
    wrap.insertBefore(statusEl, bubble);
  } else if (label) {
    label.insertAdjacentElement('afterend', statusEl);
  } else {
    wrap.prepend(statusEl);
  }

  wrap.dataset.streamPhase = 'generating';

  let disposed = false;
  let currentPhase: StreamPhase = 'generating';

  const syncElapsedVisibility = (): void => {
    const show =
      currentPhase === 'thinking' && elapsedEl.textContent.length > 0;
    elapsedEl.hidden = !show;
  };

  const setThinkingElapsed = (ms: number | null): void => {
    if (disposed) return;
    if (ms == null || ms <= 0) {
      elapsedEl.textContent = '';
      elapsedEl.hidden = true;
      return;
    }
    elapsedEl.textContent = ` ${formatThinkingDuration(ms)}`;
    syncElapsedVisibility();
  };

  const setPhase = (phase: StreamPhase): void => {
    if (disposed) return;
    currentPhase = phase;

    if (phase === 'prose' || phase === 'done') {
      elapsedEl.textContent = '';
      elapsedEl.hidden = true;
      statusEl.classList.add('hidden');
      statusEl.setAttribute('aria-busy', 'false');
      wrap.dataset.streamPhase = phase;
      return;
    }

    statusEl.classList.remove('hidden');
    statusEl.setAttribute('aria-busy', 'true');
    statusEl.classList.remove('stream-status--generating', 'stream-status--thinking');
    statusEl.classList.add(
      phase === 'thinking' ? 'stream-status--thinking' : 'stream-status--generating',
    );
    labelEl.textContent = LABEL_BY_PHASE[phase];
    wrap.dataset.streamPhase = phase;
    if (phase !== 'thinking') {
      elapsedEl.hidden = true;
    } else {
      syncElapsedVisibility();
    }
  };

  const dispose = (): void => {
    disposed = true;
    statusEl.remove();
    delete wrap.dataset.streamPhase;
  };

  return { setPhase, setThinkingElapsed, dispose };
}
