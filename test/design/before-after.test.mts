/**
 * Before/after diff pairing (MIN-370 P1): save → pre/post capture pairing and the per-chat
 * ring buffer, exercised with injected (fake) capture functions — no real preview guest needed.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { createBeforeAfterPairing, type BeforeAfterCapture } from '../../src/design/before-after.ts';

function capture(tag: string, at: number): BeforeAfterCapture {
  return { dataUrl: `data:image/png;base64,${tag}`, capturedAt: at };
}

describe('createBeforeAfterPairing', () => {
  let idSeq: number;
  let clock: number;

  beforeEach(() => {
    idSeq = 0;
    clock = 1000;
  });

  function makeController(historyLimit?: number) {
    const beforeCalls: string[] = [];
    const afterCalls: string[][] = [];
    const pairing = createBeforeAfterPairing(
      async (path) => {
        beforeCalls.push(path);
        return capture(`before:${path}`, clock);
      },
      async (paths) => {
        afterCalls.push(paths);
        return capture(`after:${paths.join(',')}`, clock);
      },
      {
        historyLimit,
        now: () => clock,
        idFactory: () => `pair-${(idSeq += 1)}`,
      },
    );
    return { pairing, beforeCalls, afterCalls };
  }

  test('a single save then reload-settled produces one finalized pair', async () => {
    const { pairing } = makeController();
    await pairing.notifyFileSaved('chat-1', 'turn-1', 'index.html');
    assert.equal(pairing.hasPending('chat-1'), true);

    const pair = await pairing.notifyReloadSettled('chat-1');
    assert.ok(pair);
    assert.equal(pair!.chatId, 'chat-1');
    assert.equal(pair!.turnId, 'turn-1');
    assert.deepEqual(pair!.paths, ['index.html']);
    assert.deepEqual(pair!.before, { dataUrl: 'data:image/png;base64,before:index.html', capturedAt: 1000 });
    assert.deepEqual(pair!.after, { dataUrl: 'data:image/png;base64,after:index.html', capturedAt: 1000 });
    assert.equal(pairing.hasPending('chat-1'), false);
    assert.deepEqual(pairing.getPairs('chat-1'), [pair]);
  });

  test('multiple saves in the same turn before reload settles fold into one pair with all paths', async () => {
    const { pairing, beforeCalls } = makeController();
    await pairing.notifyFileSaved('chat-1', 'turn-1', 'a.css');
    await pairing.notifyFileSaved('chat-1', 'turn-1', 'b.css');
    await pairing.notifyFileSaved('chat-1', 'turn-1', 'a.css'); // duplicate path, no-op

    // Only the first save in the batch captures "before" — later saves in the same batch don't
    // re-snapshot (the batch's "before" is the state prior to the whole edit run).
    assert.deepEqual(beforeCalls, ['a.css']);

    const pair = await pairing.notifyReloadSettled('chat-1');
    assert.deepEqual(pair!.paths, ['a.css', 'b.css']);
  });

  test('a new turn id starts a fresh pair even for the same chat', async () => {
    const { pairing } = makeController();
    await pairing.notifyFileSaved('chat-1', 'turn-1', 'a.css');
    await pairing.notifyFileSaved('chat-1', 'turn-2', 'b.css');
    const pair = await pairing.notifyReloadSettled('chat-1');
    assert.equal(pair!.turnId, 'turn-2');
    assert.deepEqual(pair!.paths, ['b.css']);
  });

  test('reload-settled with nothing pending is a no-op', async () => {
    const { pairing } = makeController();
    const pair = await pairing.notifyReloadSettled('chat-never-saved');
    assert.equal(pair, null);
    assert.deepEqual(pairing.getPairs('chat-never-saved'), []);
  });

  test('ring buffer keeps only the last N pairs per chat, oldest evicted first', async () => {
    const { pairing } = makeController(2);
    for (const turn of ['t1', 't2', 't3']) {
      await pairing.notifyFileSaved('chat-1', turn, `${turn}.css`);
      await pairing.notifyReloadSettled('chat-1');
    }
    const pairs = pairing.getPairs('chat-1');
    assert.equal(pairs.length, 2);
    assert.deepEqual(pairs.map((p) => p.turnId), ['t2', 't3']);
  });

  test('pairs are tracked independently per chat', async () => {
    const { pairing } = makeController();
    await pairing.notifyFileSaved('chat-a', 't1', 'a.css');
    await pairing.notifyFileSaved('chat-b', 't1', 'b.css');
    await pairing.notifyReloadSettled('chat-a');
    assert.equal(pairing.getPairs('chat-a').length, 1);
    assert.equal(pairing.getPairs('chat-b').length, 0);
    assert.equal(pairing.hasPending('chat-b'), true);
  });

  test('reset clears pending and finalized state', async () => {
    const { pairing } = makeController();
    await pairing.notifyFileSaved('chat-1', 't1', 'a.css');
    await pairing.notifyReloadSettled('chat-1');
    pairing.reset();
    assert.deepEqual(pairing.getPairs('chat-1'), []);
    assert.equal(pairing.hasPending('chat-1'), false);
  });

  test('null capture results (e.g. capture unavailable) are preserved on the finalized pair', async () => {
    const pairing = createBeforeAfterPairing(
      async () => null,
      async () => null,
      { now: () => clock },
    );
    await pairing.notifyFileSaved('chat-1', 't1', 'a.css');
    const pair = await pairing.notifyReloadSettled('chat-1');
    assert.equal(pair!.before, null);
    assert.equal(pair!.after, null);
  });
});
