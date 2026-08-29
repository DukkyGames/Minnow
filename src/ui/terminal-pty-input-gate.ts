/**
 * Hold PTY keystrokes until xterm has finished parsing the latest output.
 *
 * After a command, zsh prints the next prompt and then re-enters zle (SMKX /
 * bracketed-paste-on). xterm.js parses that output asynchronously, so ArrowUp
 * can reach the PTY while the TTY is still in cooked mode and echo as `^[[A`
 * (MIN-670 follow-up on macOS). Queue input until `term.write` completes.
 */

const DEFAULT_MAX_HOLD_MS = 500;

export interface PtyInputGateOptions {
  /** Forward one keystroke/chunk to the PTY (history intercept + WebSocket). */
  dispatch: (data: string) => void;
  /** Failsafe so a missed write-callback cannot swallow keys forever. */
  maxHoldMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (id: unknown) => void;
}

export interface PtyInputGate {
  /** Call immediately before `term.write` of PTY output. */
  beginOutputParse: () => void;
  /** Call from the `term.write` completion callback. */
  endOutputParse: () => void;
  /** Route a keystroke: queue while output is in flight, else dispatch now. */
  handleInput: (data: string) => void;
  /** Drop queued keys and in-flight counts (tab switch / disconnect). */
  reset: () => void;
  /** Test helper: how many output parses are still open. */
  pendingOutputCount: () => number;
  /** Test helper: queued keystroke chunks. */
  queuedInputCount: () => number;
}

/** Create a gate that serializes user input behind xterm output parsing. */
export function createPtyInputGate(options: PtyInputGateOptions): PtyInputGate {
  const maxHoldMs = options.maxHoldMs ?? DEFAULT_MAX_HOLD_MS;
  const now = options.now ?? Date.now;
  const schedule: (fn: () => void, ms: number) => unknown =
    options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel: (id: unknown) => void =
    options.cancel ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  let pendingOutput = 0;
  let queue: string[] = [];
  let failsafeId: unknown = null;
  let holdStartedAt = 0;

  function clearFailsafe(): void {
    if (failsafeId === null) return;
    cancel(failsafeId);
    failsafeId = null;
  }

  function flushQueue(): void {
    if (pendingOutput > 0) return;
    clearFailsafe();
    const chunks = queue;
    queue = [];
    for (const chunk of chunks) {
      options.dispatch(chunk);
    }
  }

  function armFailsafe(): void {
    clearFailsafe();
    holdStartedAt = now();
    failsafeId = schedule(() => {
      failsafeId = null;
      // A missed write callback would otherwise drop every later keystroke.
      if (pendingOutput === 0) return;
      if (now() - holdStartedAt < maxHoldMs) return;
      pendingOutput = 0;
      flushQueue();
    }, maxHoldMs);
  }

  return {
    beginOutputParse(): void {
      pendingOutput += 1;
      armFailsafe();
    },

    endOutputParse(): void {
      if (pendingOutput > 0) {
        pendingOutput -= 1;
      }
      if (pendingOutput === 0) {
        flushQueue();
        return;
      }
      armFailsafe();
    },

    handleInput(data: string): void {
      if (!data) return;
      if (pendingOutput > 0) {
        queue.push(data);
        return;
      }
      options.dispatch(data);
    },

    reset(): void {
      clearFailsafe();
      pendingOutput = 0;
      queue = [];
      holdStartedAt = 0;
    },

    pendingOutputCount(): number {
      return pendingOutput;
    },

    queuedInputCount(): number {
      return queue.length;
    },
  };
}
