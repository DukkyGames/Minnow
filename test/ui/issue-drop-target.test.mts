/**
 * Issue drop targets: accept capture drags and OS file drags.
 * List-row parent drops use capture-phase listeners so chips cannot swallow them.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import { WORKSPACE_FILE_MIME } from '../../src/attachments/workspace-ref';
import { ISSUES_COMPAT_VERSION, ISSUES_SCHEMA_VERSION, type IssueCard } from '../../src/types.ts';
import { beginIssueDrag, resetIssueDragForTests } from '../../src/issues/issue-drag.ts';
import {
  bindIssueDropTarget,
  dataTransferAcceptsIssueDrop,
} from '../../src/ui/issue-drop-target';

const { findIssueById, setIssuesStateForTests } = await import('../../src/state/issues-store.ts');

const FIXED_NOW = 1_710_000_000_000;

function fakeTransfer(types: string[], files: File[] = []): DataTransfer {
  const store = new Map<string, string>();
  return {
    get types() {
      return [...store.keys(), ...types.filter((type) => !store.has(type))];
    },
    get files() {
      const list = {
        length: files.length,
        item: (index: number) => files[index] ?? null,
        [Symbol.iterator]: function* () {
          for (const file of files) yield file;
        },
      };
      return list as unknown as FileList;
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'all',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function card(id: string, title: string): IssueCard {
  return {
    id,
    type: 'task',
    title,
    description: '',
    status: 'todo',
    priority: 'none',
    labels: [],
    workspacePath: '/w',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    source: 'user',
  };
}

function dispatchDrag(type: string, target: EventTarget, transfer: DataTransfer): DragEvent {
  const event = new DragEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer, configurable: true });
  target.dispatchEvent(event);
  return event;
}

describe('dataTransferAcceptsIssueDrop', () => {
  test('accepts workspace file-tree drags', () => {
    const transfer = fakeTransfer([WORKSPACE_FILE_MIME]);
    transfer.setData(WORKSPACE_FILE_MIME, 'src/ui/foo.ts');
    assert.equal(dataTransferAcceptsIssueDrop(transfer), true);
  });

  test('accepts OS file drags via the Files type', () => {
    const transfer = fakeTransfer(['Files']);
    assert.equal(dataTransferAcceptsIssueDrop(transfer), true);
  });

  test('accepts OS file drags when only files[] is populated', () => {
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const transfer = fakeTransfer([], [file]);
    assert.equal(dataTransferAcceptsIssueDrop(transfer), true);
  });

  test('accepts plain-text selection drags', () => {
    const transfer = fakeTransfer(['text/plain']);
    transfer.setData('text/plain', 'hello');
    assert.equal(dataTransferAcceptsIssueDrop(transfer), true);
  });

  test('does not treat issue-row MIME as a capture drop', () => {
    const transfer = fakeTransfer(['application/x-minnow-issue-id', 'text/plain']);
    transfer.setData('application/x-minnow-issue-id', 'MIN-1');
    transfer.setData('text/plain', 'MIN-1');
    assert.equal(dataTransferAcceptsIssueDrop(transfer), false);
  });
});

describe('bindIssueDropTarget parent drop', () => {
  let domWindow: Window | null = null;

  beforeEach(() => {
    const window = new Window({ url: 'http://localhost/' });
    domWindow = window;
    globalThis.window = window as unknown as Window & typeof globalThis.window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.Element = window.Element;
    globalThis.DragEvent = window.DragEvent;
    setIssuesStateForTests({
      version: ISSUES_COMPAT_VERSION,
      schemaRevision: ISSUES_SCHEMA_VERSION,
      nextId: 3,
      issues: [card('MIN-1', 'Parent'), card('MIN-2', 'Child')],
      workspaces: {},
    });
  });

  afterEach(() => {
    resetIssueDragForTests();
    setIssuesStateForTests(null);
    domWindow?.close();
    domWindow = null;
  });

  test('dragover over a nested chip still marks the row as a parent target', () => {
    const row = document.createElement('div');
    row.className = 'issues-row';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = 'Todo';
    row.appendChild(chip);
    document.body.appendChild(row);
    bindIssueDropTarget(row, 'MIN-1');
    beginIssueDrag(['MIN-2']);

    const transfer = fakeTransfer([]);
    const over = dispatchDrag('dragover', chip, transfer);

    assert.equal(over.defaultPrevented, true);
    assert.equal(transfer.dropEffect, 'link');
    assert.ok(row.classList.contains('is-parent-target'));
  });

  test('drop on a nested chip sets parentId', async () => {
    const row = document.createElement('div');
    row.className = 'issues-row';
    const chip = document.createElement('button');
    row.appendChild(chip);
    document.body.appendChild(row);
    bindIssueDropTarget(row, 'MIN-1');
    beginIssueDrag(['MIN-2']);

    const transfer = fakeTransfer([]);
    dispatchDrag('drop', chip, transfer);
    await import('../../src/ui/issues-sub-issues.ts');
    await Promise.resolve();

    assert.equal(findIssueById('MIN-2')?.parentId, 'MIN-1');
  });
});
