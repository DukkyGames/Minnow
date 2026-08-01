/**
 * open_in_editor — argument validation, the range passed to the viewer, and the
 * load-outcome report (a tool that claims success on a broken path teaches the
 * model nothing).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  toolOpenInEditor,
  type EditorLineRange,
  type EditorTabStatus,
} from '../../src/tools/open-editor-tool.ts';

/** Records opens and replays a scripted sequence of tab statuses. */
function harness(statuses: EditorTabStatus[] = [{ status: 'ready' }]) {
  const calls: { path: string; range?: EditorLineRange }[] = [];
  const queue = [...statuses];
  let waits = 0;
  return {
    calls,
    get waits() {
      return waits;
    },
    deps: {
      openFile: async (path: string, range?: EditorLineRange) => {
        calls.push({ path, range });
      },
      readTabStatus: (): EditorTabStatus =>
        queue.length > 1 ? (queue.shift() as EditorTabStatus) : queue[0],
      delay: async () => {
        waits += 1;
      },
    },
  };
}

describe('open_in_editor', () => {
  test('requires a path', async () => {
    const h = harness();
    for (const args of [{}, { path: '' }, { path: '   ' }, { path: 42 }]) {
      const out = await toolOpenInEditor(args as Record<string, unknown>, h.deps);
      assert.match(out, /^Error: "path" is required/);
    }
    assert.equal(h.calls.length, 0);
  });

  test('opens a whole file when no line is given', async () => {
    const h = harness();
    const out = await toolOpenInEditor({ path: 'src/cart.ts' }, h.deps);
    assert.deepEqual(h.calls, [{ path: 'src/cart.ts', range: undefined }]);
    assert.match(out, /Opened src\/cart\.ts in the Code editor\./);
    assert.doesNotMatch(out, /highlighted/);
  });

  test('highlights an explicit range', async () => {
    const h = harness();
    const out = await toolOpenInEditor(
      { path: 'src/cart.ts', start_line: 40, end_line: 52 },
      h.deps,
    );
    assert.deepEqual(h.calls[0].range, { startLine: 40, endLine: 52 });
    assert.match(out, /highlighted lines 40-52/);
  });

  test('end_line defaults to start_line', async () => {
    const h = harness();
    const out = await toolOpenInEditor({ path: 'a.ts', start_line: 7 }, h.deps);
    assert.deepEqual(h.calls[0].range, { startLine: 7, endLine: 7 });
    assert.match(out, /highlighted line 7\b/);
  });

  test('a backwards range collapses to start_line rather than failing', async () => {
    const h = harness();
    await toolOpenInEditor({ path: 'a.ts', start_line: 20, end_line: 4 }, h.deps);
    assert.deepEqual(h.calls[0].range, { startLine: 20, endLine: 20 });
  });

  test('accepts numeric strings and truncates floats', async () => {
    const h = harness();
    await toolOpenInEditor({ path: 'a.ts', start_line: '12', end_line: '15.9' }, h.deps);
    assert.deepEqual(h.calls[0].range, { startLine: 12, endLine: 15 });
  });

  test('rejects non-positive and non-numeric line numbers', async () => {
    const h = harness();
    const zero = await toolOpenInEditor({ path: 'a.ts', start_line: 0 }, h.deps);
    assert.match(zero, /^Error: "start_line" must be a positive integer/);

    const text = await toolOpenInEditor({ path: 'a.ts', start_line: 'top' }, h.deps);
    assert.match(text, /^Error: "start_line" must be a positive integer/);

    const badEnd = await toolOpenInEditor(
      { path: 'a.ts', start_line: 3, end_line: -2 },
      h.deps,
    );
    assert.match(badEnd, /^Error: "end_line" must be a positive integer/);

    assert.equal(h.calls.length, 0);
  });

  test('end_line without start_line is an error, not a silent whole-file open', async () => {
    const h = harness();
    const out = await toolOpenInEditor({ path: 'a.ts', end_line: 12 }, h.deps);
    assert.match(out, /^Error: "end_line" needs "start_line"/);
    assert.equal(h.calls.length, 0);
  });

  test('normalizes Windows separators for the viewer', async () => {
    const h = harness();
    await toolOpenInEditor({ path: ' src\\ui\\cart.ts ' }, h.deps);
    assert.equal(h.calls[0].path, 'src/ui/cart.ts');
  });

  test('reports the viewer load error instead of claiming success', async () => {
    const h = harness([{ status: 'error', error: "ENOENT: stat 'main.py'" }]);
    const out = await toolOpenInEditor({ path: 'main.py', start_line: 2 }, h.deps);
    assert.match(out, /^Error: could not open main\.py in the editor/);
    assert.match(out, /ENOENT/);
    assert.match(out, /Check the path against the workspace/);
  });

  test('waits for a loading tab, then reports the settled outcome', async () => {
    const h = harness([{ status: 'loading' }, { status: 'loading' }, { status: 'ready' }]);
    const out = await toolOpenInEditor({ path: 'a.ts' }, h.deps);
    assert.ok(h.waits >= 1, 'should have polled at least once');
    assert.match(out, /The user can see it now/);
  });

  test('says so when the tab is still loading at the timeout', async () => {
    const h = harness([{ status: 'loading' }]);
    const out = await toolOpenInEditor({ path: 'big.ts' }, h.deps);
    assert.match(out, /still loading/);
  });

  test('viewer failures propagate to the executor catch (which prefixes "Error:")', async () => {
    const failing = {
      openFile: async () => {
        throw new Error('file not found');
      },
      readTabStatus: (): EditorTabStatus => ({ status: 'ready' }),
    };
    await assert.rejects(
      () => toolOpenInEditor({ path: 'missing.ts' }, failing),
      /file not found/,
    );
  });
});
