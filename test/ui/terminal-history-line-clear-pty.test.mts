/**
 * MIN-670: Ctrl+A/Ctrl+K line replace is echoed as caret notation when the
 * shell line editor does not bind those keys (zsh, bash vi-mode). This is why
 * shipped PTY profiles must pass ArrowUp/Down through instead of injecting
 * HISTORY_LINE_CLEAR.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pty from '@lydell/node-pty';
import {
  HISTORY_LINE_CLEAR,
  shouldInterceptPtyHistoryArrow,
} from '../../src/ui/terminal-history-nav.ts';

const isWin = process.platform === 'win32';
const isDarwin = process.platform === 'darwin';
const hasZsh = fs.existsSync('/bin/zsh');

/** Wait until PTY output matches `pred`, or fail with a trailing snippet. */
function waitForOutput(
  proc: ReturnType<typeof pty.spawn>,
  pred: (acc: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let acc = '';
    const timer = setTimeout(() => {
      disposable.dispose();
      reject(new Error(`timeout: ${JSON.stringify(acc.slice(-240))}`));
    }, timeoutMs);
    const disposable = proc.onData((chunk) => {
      acc += String(chunk);
      if (pred(acc)) {
        clearTimeout(timer);
        disposable.dispose();
        resolve(acc);
      }
    });
  });
}

/** Collect PTY output for a fixed window after writing input. */
function collectAfterWrite(
  proc: ReturnType<typeof pty.spawn>,
  data: string,
  ms: number,
): Promise<string> {
  return new Promise((resolve) => {
    let acc = '';
    const disposable = proc.onData((chunk) => {
      acc += String(chunk);
    });
    proc.write(data);
    setTimeout(() => {
      disposable.dispose();
      resolve(acc);
    }, ms);
  });
}

describe('terminal HISTORY_LINE_CLEAR PTY (MIN-670)', { skip: isWin }, () => {
  it('does not intercept ArrowUp on a used bash tab', () => {
    assert.equal(
      shouldInterceptPtyHistoryArrow({
        data: '\x1b[A',
        shellProfileId: 'bash',
        tabHistoryLength: 6,
      }),
      false,
    );
  });

  it('bash vi-mode echoes Ctrl+A Ctrl+K as ^A^K (the used-tab history bug)', async () => {
    const proc = pty.spawn('/bin/bash', ['--norc', '--noprofile'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        HISTFILE: '/tmp/minnow-min670-hist-test',
      },
    });

    try {
      proc.write('export PS1="TESTPROMPT% "\r');
      await waitForOutput(proc, (s) => s.includes('TESTPROMPT%'), 5000);
      proc.write('set -o vi\r');
      await waitForOutput(proc, (s) => s.includes('TESTPROMPT%'), 5000);

      const injected = await collectAfterWrite(
        proc,
        `${HISTORY_LINE_CLEAR}npm run dev`,
        700,
      );

      assert.match(
        injected,
        /\^A\^Knpm run dev/,
        'expected caret-notation leak matching the MIN-670 screenshot',
      );

      proc.write('\u0015');
      await new Promise((r) => setTimeout(r, 150));
      proc.write('echo minnow-hist-native\r');
      await waitForOutput(proc, (s) => s.includes('minnow-hist-native'), 5000);

      const recalled = await collectAfterWrite(proc, '\x1b[A', 700);
      assert.doesNotMatch(
        recalled,
        /\^A\^K/,
        'native ArrowUp must not inject Ctrl+A/Ctrl+K caret notation',
      );
      assert.match(recalled, /minnow-hist-native/);
    } finally {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    }
  });

  it('zsh echoes CSI ArrowUp as ^[[A when it arrives before the next zle prompt', { skip: !isDarwin || !hasZsh }, async () => {
    const histFile = '/tmp/minnow-min670-zsh-hist-test';
    const proc = pty.spawn('/bin/zsh', ['-f', '-i'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {
        TERM: 'xterm-256color',
        HISTFILE: histFile,
        PS1: 'TESTPROMPT% ',
        PROMPT: 'TESTPROMPT% ',
      },
    });

    try {
      proc.write('export PS1="TESTPROMPT% " PROMPT="TESTPROMPT% "\r');
      await waitForOutput(proc, (s) => s.includes('TESTPROMPT%'), 5000);
      proc.write('echo minnow-zsh-race\r');
      await waitForOutput(proc, (s) => s.includes('minnow-zsh-race'), 5000);

      // Same race the SPA hits: xterm parses the prompt asynchronously, so the
      // key can land while zsh is still in cooked mode and echoctl paints ^[[A.
      const immediate = await collectAfterWrite(proc, '\x1b[A', 700);
      assert.match(
        immediate,
        /\^\[\[A/,
        'expected cooked-mode caret echo of CSI ArrowUp before zle restarts',
      );
    } finally {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    }
  });

  it('zsh recalls history from CSI ArrowUp once bracketed paste is back on', { skip: !hasZsh }, async () => {
    const proc = pty.spawn('/bin/zsh', ['-f', '-i'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: {
        TERM: 'xterm-256color',
        HISTFILE: '/tmp/minnow-min670-zsh-hist-ready',
        PS1: 'TESTPROMPT% ',
        PROMPT: 'TESTPROMPT% ',
      },
    });

    try {
      proc.write('export PS1="TESTPROMPT% " PROMPT="TESTPROMPT% "\r');
      await waitForOutput(proc, (s) => s.includes('TESTPROMPT%'), 5000);
      proc.write('echo minnow-zsh-ready\r');
      await waitForOutput(proc, (s) => s.includes('\x1b[?2004h'), 5000);
      await new Promise((r) => setTimeout(r, 80));

      const recalled = await collectAfterWrite(proc, '\x1b[A', 700);
      assert.doesNotMatch(recalled, /\^\[\[A/);
      assert.match(recalled, /minnow-zsh-ready/);
    } finally {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    }
  });
});
