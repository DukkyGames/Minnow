/**
 * Unit tests for git log line parsing (%D ref decorators).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseLogLine } from '../../server/git/git-ops.js';

describe('parseLogLine', () => {
  test('parses bare comma-separated refs after relative time', () => {
    const parsed = parseLogLine(
      '330e95e8556a51d8c0962229089f387d617b4e48 f7fc4702a0aced650ab8c3bed807c527b52253ce Add auto-resize desktop composer (8-line cap) DukkyGames 2 hours ago origin/Orchestrator-board-upgrade, Orchestrator-board-upgrade',
    );

    assert.ok(parsed);
    assert.equal(parsed.hash, '330e95e8556a51d8c0962229089f387d617b4e48');
    assert.deepEqual(parsed.parents, ['f7fc4702a0aced650ab8c3bed807c527b52253ce']);
    assert.equal(parsed.subject, 'Add auto-resize desktop composer (8-line cap)');
    assert.equal(parsed.author, 'DukkyGames');
    assert.equal(parsed.relativeTime, '2 hours ago');
    assert.deepEqual(parsed.refs, [
      'origin/Orchestrator-board-upgrade',
      'Orchestrator-board-upgrade',
    ]);
  });

  test('parses HEAD and remote refs after relative time', () => {
    const parsed = parseLogLine(
      '5f6816e56ada952293ea7eea2a26114c9577a246 6ac48bee66cf47b300cbb3b7c13febb71f489d67 fix(settings): update general settings description and add network access field DukkyGames 13 minutes ago HEAD -> main, origin/main, origin/HEAD',
    );

    assert.ok(parsed);
    assert.equal(parsed.subject, 'fix(settings): update general settings description and add network access field');
    assert.equal(parsed.relativeTime, '13 minutes ago');
    assert.deepEqual(parsed.refs, ['HEAD -> main', 'origin/main', 'origin/HEAD']);
  });

  test('parses commits without decorators', () => {
    const parsed = parseLogLine(
      '6ac48bee66cf47b300cbb3b7c13febb71f489d67 381919a048e5ed140a02ceb7a401bc7cb9b0e3fc feat(network): implement LAN access and enhance network configuration DukkyGames 36 minutes ago ',
    );

    assert.ok(parsed);
    assert.equal(parsed.subject, 'feat(network): implement LAN access and enhance network configuration');
    assert.deepEqual(parsed.refs, []);
  });

  test('parses %x1f-delimited lines with multi-word authors exactly', () => {
    const SEP = '\u001f';
    const parsed = parseLogLine(
      [
        '5f6816e56ada952293ea7eea2a26114c9577a246',
        '6ac48bee66cf47b300cbb3b7c13febb71f489d67',
        '🐛 Fix Super Plan research sources list overflow and scrolling',
        'Cursor Agent',
        '2 hours ago',
        'HEAD -> main, origin/main',
      ].join(SEP),
    );

    assert.ok(parsed);
    assert.equal(parsed.subject, '🐛 Fix Super Plan research sources list overflow and scrolling');
    assert.equal(parsed.author, 'Cursor Agent');
    assert.equal(parsed.relativeTime, '2 hours ago');
    assert.deepEqual(parsed.refs, ['HEAD -> main', 'origin/main']);
  });

  test('parses %x1f-delimited merge commits and empty fields', () => {
    const SEP = '\u001f';
    const parsed = parseLogLine(
      [
        '5f6816e56ada952293ea7eea2a26114c9577a246',
        '6ac48bee66cf47b300cbb3b7c13febb71f489d67 381919a048e5ed140a02ceb7a401bc7cb9b0e3fc',
        'Merge branch main into feature',
        'DukkyGames',
        'just now',
        '',
      ].join(SEP),
    );

    assert.ok(parsed);
    assert.deepEqual(parsed.parents, [
      '6ac48bee66cf47b300cbb3b7c13febb71f489d67',
      '381919a048e5ed140a02ceb7a401bc7cb9b0e3fc',
    ]);
    assert.equal(parsed.author, 'DukkyGames');
    assert.deepEqual(parsed.refs, []);
  });
});
