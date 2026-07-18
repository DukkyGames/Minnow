/**
 * Brain usage counters — week bucketing, pruning, and never-throws behavior.
 *
 * These numbers are the only evidence that the wiki is actually being read and
 * written, so the bucketing has to be right; but they are diagnostics, so a
 * failure here must never propagate into a tool call.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

let home;
let mod;

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-usage-'));
  process.env.MINNOW_HOME = home;
  mod = await import('../../server/brain/usage.js');
});

after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe('isoWeekKey', () => {
  test('formats as YYYY-Www with a zero-padded week', () => {
    assert.match(mod.isoWeekKey(new Date('2026-07-18T12:00:00Z')), /^\d{4}-W\d{2}$/);
    assert.equal(mod.isoWeekKey(new Date('2026-01-08T12:00:00Z')), '2026-W02');
  });

  test('days in the same ISO week share a bucket', () => {
    // Monday through Sunday of one ISO week.
    const monday = mod.isoWeekKey(new Date('2026-07-13T09:00:00Z'));
    const sunday = mod.isoWeekKey(new Date('2026-07-19T23:00:00Z'));
    assert.equal(monday, sunday);
  });

  test('adjacent weeks land in different buckets', () => {
    const w1 = mod.isoWeekKey(new Date('2026-07-19T12:00:00Z'));
    const w2 = mod.isoWeekKey(new Date('2026-07-20T12:00:00Z'));
    assert.notEqual(w1, w2);
  });

  test('a week spanning New Year is not split', () => {
    // 2025-12-29 (Mon) through 2026-01-04 (Sun) is one ISO week: 2026-W01.
    assert.equal(mod.isoWeekKey(new Date('2025-12-29T12:00:00Z')), '2026-W01');
    assert.equal(mod.isoWeekKey(new Date('2026-01-04T12:00:00Z')), '2026-W01');
  });
});

describe('pruneWeeks', () => {
  test('keeps only the most recent buckets', () => {
    const weeks = {};
    for (let i = 1; i <= 20; i += 1) {
      weeks[`2026-W${String(i).padStart(2, '0')}`] = { 'agent-read': i };
    }
    const pruned = mod.pruneWeeks(weeks);
    const keys = Object.keys(pruned).sort();
    assert.equal(keys.length, mod.USAGE_WEEKS_KEPT);
    assert.equal(keys.at(-1), '2026-W20');
    assert.ok(!('2026-W01' in pruned));
  });

  test('leaves a short history untouched', () => {
    const weeks = { '2026-W01': { 'agent-read': 1 }, '2026-W02': { 'agent-read': 2 } };
    assert.deepEqual(mod.pruneWeeks(weeks), weeks);
  });
});

describe('recordBrainUsage', () => {
  test('increments the current week bucket', async () => {
    const now = new Date('2026-07-15T12:00:00Z');
    await mod.recordBrainUsage('agent-read', now);
    await mod.recordBrainUsage('agent-read', now);
    await mod.recordBrainUsage('synthesis-write', now);

    const usage = await mod.readBrainUsage(now);
    assert.equal(usage.week, mod.isoWeekKey(now));
    assert.equal(usage.thisWeek['agent-read'], 2);
    assert.equal(usage.thisWeek['synthesis-write'], 1);
  });

  test('separates counts across weeks', async () => {
    const later = new Date('2026-08-15T12:00:00Z');
    await mod.recordBrainUsage('agent-write', later);

    const thisWeek = await mod.readBrainUsage(later);
    assert.equal(thisWeek.thisWeek['agent-write'], 1);
    assert.equal(thisWeek.thisWeek['agent-read'], undefined);

    const earlier = await mod.readBrainUsage(new Date('2026-07-15T12:00:00Z'));
    assert.equal(earlier.thisWeek['agent-read'], 2);
  });

  test('ignores unknown kinds instead of recording them', async () => {
    const now = new Date('2026-09-15T12:00:00Z');
    await mod.recordBrainUsage('not-a-real-kind', now);
    const usage = await mod.readBrainUsage(now);
    assert.deepEqual(usage.thisWeek, {});
  });

  test('never throws when the store is unwritable', async () => {
    const prev = process.env.MINNOW_HOME;
    // Point at a path that cannot be created as a directory.
    process.env.MINNOW_HOME = path.join(home, 'usage-blocked.txt');
    await fs.writeFile(process.env.MINNOW_HOME, 'not a directory', 'utf8');
    await mod.recordBrainUsage('agent-read');
    process.env.MINNOW_HOME = prev;
  });

  test('reads an empty report when nothing was ever recorded', async () => {
    const usage = await mod.readBrainUsage(new Date('2030-01-15T12:00:00Z'));
    assert.deepEqual(usage.thisWeek, {});
  });
});
