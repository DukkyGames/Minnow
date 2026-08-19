/**
 * Capture: menu-target translation and the DataTransfer bridge.
 *
 * These are the two seams every capture entry point runs through — a surface
 * describing what it has, and a drag carrying it — so they are tested without
 * the popover.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CAPTURE_MENU_KINDS,
  capturePayloadFromMenuTarget,
  legacyCaptureMenuItems,
} from '../../src/ui/issue-capture';
import {
  ISSUE_CAPTURE_MIME,
  parseCaptureDragData,
  setCaptureDragData,
} from '../../src/issues/capture-payload';

/** Minimal DataTransfer stand-in: happy-dom does not ship a usable one. */
function fakeTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'none',
  } as unknown as DataTransfer;
}

describe('capturePayloadFromMenuTarget', () => {
  test('a file target becomes a file item with a code ref', () => {
    const payload = capturePayloadFromMenuTarget({
      kind: CAPTURE_MENU_KINDS.file,
      path: 'src/ui/foo.ts',
    });
    assert.ok(payload);
    assert.equal(payload.sourceLabel, 'File');
    assert.equal(payload.items[0].kind, 'file');
    assert.equal(payload.items[0].codeRef?.path, 'src/ui/foo.ts');
    assert.equal(payload.title, 'foo.ts');
  });

  test('an editor selection carries the range and the snippet', () => {
    const payload = capturePayloadFromMenuTarget({
      kind: CAPTURE_MENU_KINDS.editorSelection,
      path: 'src/a.ts',
      startLine: 4,
      endLine: 9,
      text: 'boom()',
    });
    assert.ok(payload);
    assert.equal(payload.items[0].label, 'a.ts L4-9');
    assert.equal(payload.items[0].codeRef?.startLine, 4);
    assert.equal(payload.items[0].codeRef?.endLine, 9);
    assert.equal(payload.items[0].text, 'boom()');
  });

  test('a single-line selection omits the range suffix', () => {
    const payload = capturePayloadFromMenuTarget({
      kind: CAPTURE_MENU_KINDS.editorSelection,
      path: 'src/a.ts',
      startLine: 4,
      endLine: 4,
      text: 'boom()',
    });
    assert.equal(payload?.items[0].label, 'a.ts L4');
  });

  test('a commit becomes a git link titled with its subject', () => {
    const payload = capturePayloadFromMenuTarget({
      kind: CAPTURE_MENU_KINDS.commit,
      hash: '0123456789abcdef',
      subject: 'Fix the thing',
    });
    assert.ok(payload);
    assert.equal(payload.title, 'Fix the thing');
    assert.equal(payload.items[0].label, '01234567');
    assert.equal(payload.items[0].gitLink?.kind, 'commit');
    assert.equal(payload.items[0].gitLink?.ref, '0123456789abcdef');
  });

  test('terminal output keeps the text and seeds the title from its first line', () => {
    const payload = capturePayloadFromMenuTarget({
      kind: CAPTURE_MENU_KINDS.terminalSelection,
      text: '\nError: ENOENT\n  at read()',
    });
    assert.ok(payload);
    assert.equal(payload.title, 'Error: ENOENT');
    assert.equal(payload.items[0].kind, 'text');
  });

  test('an unknown kind contributes nothing', () => {
    assert.equal(capturePayloadFromMenuTarget({ kind: 'something-else' }), null);
  });

  test('a target of a known kind with no payload contributes nothing', () => {
    assert.equal(capturePayloadFromMenuTarget({ kind: CAPTURE_MENU_KINDS.commit }), null);
  });
});

describe('legacyCaptureMenuItems', () => {
  test('offers create and add rows for a capturable target', () => {
    const rows = legacyCaptureMenuItems({
      kind: CAPTURE_MENU_KINDS.file,
      path: 'src/a.ts',
    });
    assert.deepEqual(
      rows.map((row) => row.label),
      ['Create issue…', 'Add to issue…'],
    );
  });

  test('offers nothing when the target carries nothing', () => {
    assert.deepEqual(legacyCaptureMenuItems({ kind: CAPTURE_MENU_KINDS.file }), []);
  });
});

describe('capture drag transfer', () => {
  test('round-trips through a DataTransfer', () => {
    const transfer = fakeTransfer();
    setCaptureDragData(transfer, {
      title: 'Broken',
      items: [{ kind: 'code', label: 'a.ts L1', codeRef: { path: 'a.ts', startLine: 1 } }],
    });
    assert.ok(transfer.types.includes(ISSUE_CAPTURE_MIME));
    // text/plain is set so a drop into a text field is still readable.
    assert.equal(transfer.getData('text/plain'), 'Broken');

    const parsed = parseCaptureDragData(transfer);
    assert.equal(parsed?.title, 'Broken');
    assert.equal(parsed?.items[0].codeRef?.path, 'a.ts');
  });

  test('a transfer without the capture MIME parses to null', () => {
    const transfer = fakeTransfer();
    transfer.setData('text/plain', 'just text');
    assert.equal(parseCaptureDragData(transfer), null);
  });
});
