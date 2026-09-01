import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPtyInputGate } from '../../src/ui/terminal-pty-input-gate.ts';

describe('terminal-pty-input-gate', () => {
  it('dispatches immediately when no output parse is in flight', () => {
    const sent: string[] = [];
    const gate = createPtyInputGate({ dispatch: (data) => sent.push(data) });

    gate.handleInput('\x1b[A');

    assert.deepEqual(sent, ['\x1b[A']);
    assert.equal(gate.queuedInputCount(), 0);
  });

  it('MIN-670 follow-up: queues ArrowUp until xterm finishes parsing the prompt', () => {
    const sent: string[] = [];
    const gate = createPtyInputGate({ dispatch: (data) => sent.push(data) });

    // Command output + next prompt is still being parsed (bracketed-paste-on
    // has not reached the DEC mode handler yet).
    gate.beginOutputParse();
    gate.handleInput('\x1b[A');
    gate.handleInput('\x1b[B');

    assert.deepEqual(sent, []);
    assert.equal(gate.queuedInputCount(), 2);
    assert.equal(gate.pendingOutputCount(), 1);

    // Parser finished: zsh is back in zle, so the queued CSI is safe to send.
    gate.endOutputParse();

    assert.deepEqual(sent, ['\x1b[A', '\x1b[B']);
    assert.equal(gate.queuedInputCount(), 0);
  });

  it('keeps queuing across overlapping writes and flushes only when the last completes', () => {
    const sent: string[] = [];
    const gate = createPtyInputGate({ dispatch: (data) => sent.push(data) });

    gate.beginOutputParse();
    gate.beginOutputParse();
    gate.handleInput('a');
    gate.endOutputParse();
    assert.deepEqual(sent, []);

    gate.handleInput('b');
    gate.endOutputParse();
    assert.deepEqual(sent, ['a', 'b']);
  });

  it('does not fire the failsafe while output chunks keep arriving', () => {
    const sent: string[] = [];
    let now = 1_000;
    const timers: Array<() => void> = [];

    const gate = createPtyInputGate({
      dispatch: (data) => sent.push(data),
      maxHoldMs: 100,
      now: () => now,
      schedule: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      cancel: () => {
        timers.length = 0;
      },
    });

    gate.beginOutputParse();
    gate.handleInput('\x1b[A');
    now = 1_050;
    gate.beginOutputParse();
    assert.equal(timers.length, 1);
    now = 1_149;
    timers[0]();
    assert.deepEqual(sent, []);
    assert.equal(gate.pendingOutputCount(), 2);

    gate.endOutputParse();
    gate.endOutputParse();
    assert.deepEqual(sent, ['\x1b[A']);
  });

  it('flushes a stuck parse after maxHoldMs so keys cannot be swallowed forever', () => {
    const sent: string[] = [];
    let now = 1_000;
    /** @type {Array<() => void>} */
    const timers: Array<() => void> = [];

    const gate = createPtyInputGate({
      dispatch: (data) => sent.push(data),
      maxHoldMs: 100,
      now: () => now,
      schedule: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      cancel: () => {
        timers.length = 0;
      },
    });

    gate.beginOutputParse();
    gate.handleInput('\x1b[A');
    assert.deepEqual(sent, []);

    now = 1_100;
    assert.equal(timers.length, 1);
    timers[0]();

    assert.deepEqual(sent, ['\x1b[A']);
    assert.equal(gate.pendingOutputCount(), 0);
  });

  it('reset drops queued keys and in-flight parses', () => {
    const sent: string[] = [];
    const gate = createPtyInputGate({ dispatch: (data) => sent.push(data) });

    gate.beginOutputParse();
    gate.handleInput('x');
    gate.reset();
    gate.handleInput('y');

    assert.deepEqual(sent, ['y']);
    assert.equal(gate.queuedInputCount(), 0);
    assert.equal(gate.pendingOutputCount(), 0);
  });

  it('ignores empty input chunks', () => {
    const sent: string[] = [];
    const gate = createPtyInputGate({ dispatch: (data) => sent.push(data) });
    gate.handleInput('');
    assert.deepEqual(sent, []);
  });
});
