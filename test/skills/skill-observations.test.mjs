/**
 * Skill observation store — the recurrence gate's memory.
 *
 * A skill proposed from a single session is noise: the old pipeline fired on
 * nearly every turn and proposed hyper-specific one-off procedures. Observations
 * hold candidates until the same problem class shows up in a *different*
 * session, so these tests pin the distinct-session counting in particular.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

let home;
let mod;

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-obs-'));
  process.env.MINNOW_HOME = home;
  mod = await import('../../server/skills/observations.js');
});

after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe('matchScore', () => {
  test('identical titles score 1', () => {
    const score = mod.matchScore(
      { title: 'Pin dev server port' },
      { title: 'Pin dev server port' },
    );
    assert.equal(score, 1);
  });

  test('same problem class scores above the default threshold', () => {
    const score = mod.matchScore(
      { title: 'Pin the dev server port', tags: ['vite', 'port'] },
      { title: 'Pinning a dev server port', tags: ['port', 'server'] },
    );
    assert.ok(score >= mod.DEFAULT_MATCH_THRESHOLD, `score was ${score}`);
  });

  test('unrelated titles score below the threshold', () => {
    const score = mod.matchScore(
      { title: 'Pin dev server port', tags: ['vite'] },
      { title: 'Rotate database credentials', tags: ['postgres'] },
    );
    assert.ok(score < mod.DEFAULT_MATCH_THRESHOLD, `score was ${score}`);
  });

  test('empty keyword sets score 0', () => {
    assert.equal(mod.matchScore({ title: '' }, { title: 'Anything' }), 0);
    assert.equal(mod.matchScore({ title: 'the of a' }, { title: 'the of a' }), 0);
  });

  test('tags contribute to the keyword set', () => {
    const withTag = mod.matchScore(
      { title: 'Fix build', tags: ['webpack'] },
      { title: 'Fix build', tags: ['webpack'] },
    );
    assert.equal(withTag, 1);
  });
});

describe('countDistinctSessions', () => {
  test('two observations from the same chat count once', () => {
    const count = mod.countDistinctSessions([
      { sourceChatId: 'chat-a' },
      { sourceChatId: 'chat-a' },
    ]);
    assert.equal(count, 1);
  });

  test('two observations from different chats count twice', () => {
    const count = mod.countDistinctSessions([
      { sourceChatId: 'chat-a' },
      { sourceChatId: 'chat-b' },
    ]);
    assert.equal(count, 2);
  });

  test('observations without a chat id each count once', () => {
    const count = mod.countDistinctSessions([{}, {}, { sourceChatId: 'chat-a' }]);
    assert.equal(count, 3);
  });

  test('empty list counts zero', () => {
    assert.equal(mod.countDistinctSessions([]), 0);
  });
});

describe('pruneObservations', () => {
  test('drops rows older than the retention window', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    const kept = mod.pruneObservations(
      [{ createdAt: old }, { createdAt: fresh }],
      45,
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].createdAt, fresh);
  });

  test('drops rows with an unparseable timestamp', () => {
    assert.equal(mod.pruneObservations([{ createdAt: 'nonsense' }], 45).length, 0);
  });
});

describe('observation store round-trip', () => {
  test('adds and lists an open observation', async () => {
    await mod.clearSkillObservations();
    const row = await mod.addSkillObservation({
      title: 'Pin dev server port',
      problem: 'Server drifts to a new port',
      solution: 'Pass --port with --strictPort',
      steps: ['find the dev script', 'add --port N --strictPort'],
      tags: ['vite', 'port'],
      confidence: 0.8,
      sourceChatId: 'chat-1',
    });

    assert.ok(row.id);
    assert.equal(row.status, 'open');

    const open = await mod.listOpenObservations();
    assert.equal(open.length, 1);
    assert.equal(open[0].title, 'Pin dev server port');
  });

  test('finds matching observations and ignores unrelated ones', async () => {
    await mod.clearSkillObservations();
    await mod.addSkillObservation({
      title: 'Pin dev server port',
      tags: ['vite', 'port'],
      sourceChatId: 'chat-1',
    });
    await mod.addSkillObservation({
      title: 'Rotate database credentials',
      tags: ['postgres'],
      sourceChatId: 'chat-2',
    });

    const matches = await mod.findMatchingObservations({
      title: 'Pinning a dev server port',
      tags: ['port', 'server'],
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].title, 'Pin dev server port');
  });

  test('markObservationsProposed removes rows from the open pool', async () => {
    await mod.clearSkillObservations();
    const row = await mod.addSkillObservation({
      title: 'Pin dev server port',
      tags: ['port'],
      sourceChatId: 'chat-1',
    });

    const changed = await mod.markObservationsProposed([row.id]);
    assert.equal(changed, 1);

    const open = await mod.listOpenObservations();
    assert.equal(open.length, 0);

    // Idempotent — re-marking changes nothing.
    assert.equal(await mod.markObservationsProposed([row.id]), 0);
  });

  test('markObservationsProposed with no ids is a no-op', async () => {
    assert.equal(await mod.markObservationsProposed([]), 0);
  });

  test('recurrence across two sessions clears a min-2 gate; one session does not', async () => {
    await mod.clearSkillObservations();
    const candidate = { title: 'Pin dev server port', tags: ['port'] };

    await mod.addSkillObservation({ ...candidate, sourceChatId: 'chat-1' });
    let matches = await mod.findMatchingObservations(candidate);
    assert.equal(mod.countDistinctSessions(matches), 1);

    await mod.addSkillObservation({ ...candidate, sourceChatId: 'chat-1' });
    matches = await mod.findMatchingObservations(candidate);
    assert.equal(
      mod.countDistinctSessions(matches),
      1,
      'same chat twice must not clear the gate',
    );

    await mod.addSkillObservation({ ...candidate, sourceChatId: 'chat-2' });
    matches = await mod.findMatchingObservations(candidate);
    assert.equal(mod.countDistinctSessions(matches), 2);
  });
});
