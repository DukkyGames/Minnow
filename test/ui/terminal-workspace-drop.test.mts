/**
 * Terminal workspace path drop — highlights host and inserts path at the PTY prompt.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Window } from 'happy-dom';
import { WORKSPACE_FILE_MIME } from '../../src/attachments/workspace-ref.ts';

const insertMock = mock.fn((_text: string) => undefined);

mock.module('../../src/ui/terminal-xterm.ts', {
  namedExports: {
    insertTextAtTerminalInput: insertMock,
    initTerminalXterm: () => undefined,
  },
});

function setupTerminalHostDom(): { host: HTMLElement; window: Window } {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.DragEvent = window.DragEvent;

  const host = document.createElement('div');
  host.id = 'terminalXtermHost';
  host.className = 'terminal-xterm-host';
  document.body.appendChild(host);

  return { host, window };
}

function makeWorkspacePathTransfer(path: string): DataTransfer {
  return {
    types: [WORKSPACE_FILE_MIME, 'text/plain'],
    files: [] as unknown as FileList,
    getData: (type: string) => {
      if (type === WORKSPACE_FILE_MIME) return path;
      if (type === 'text/plain') return path;
      return '';
    },
    dropEffect: 'none',
    effectAllowed: 'all',
  } as DataTransfer;
}

describe('initTerminalWorkspaceDrop', () => {
  let testWindow: Window | undefined;

  afterEach(() => {
    document.body.replaceChildren();
    testWindow?.close();
    testWindow = undefined;
    insertMock.mock.resetCalls();
  });

  it('inserts workspace path when a file-tree row is dropped on the terminal host', async () => {
    const { host, window } = setupTerminalHostDom();
    testWindow = window;

    const { initTerminalWorkspaceDrop } = await import(
      '../../src/ui/terminal-workspace-drop.ts'
    );
    initTerminalWorkspaceDrop(host);

    const transfer = makeWorkspacePathTransfer('src/ui/file-tree.ts');
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: transfer });
    host.dispatchEvent(over);
    assert.ok(host.classList.contains('terminal-xterm-host--drop-active'));

    const event = new DragEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    host.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(insertMock.mock.callCount(), 1);
    assert.equal(insertMock.mock.calls[0]?.arguments[0], 'src/ui/file-tree.ts');
    assert.equal(host.classList.contains('terminal-xterm-host--drop-active'), false);
  });
});
