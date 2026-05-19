/**
 * Live stream phase labels (generating / thinking) shown beside the assistant row
 * until the prose bubble is revealed.
 */

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

  statusEl.appendChild(dots);
  statusEl.appendChild(labelEl);

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

  const setPhase = (phase: StreamPhase): void => {
    if (disposed) return;

    if (phase === 'prose' || phase === 'done') {
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
  };

  const dispose = (): void => {
    disposed = true;
    statusEl.remove();
    delete wrap.dataset.streamPhase;
  };

  return { setPhase, dispose };
}
