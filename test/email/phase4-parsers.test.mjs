/**
 * Phase 4 AI layer — pure parsers and the priority heuristic (MIN-355).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseTriageJson, TRIAGE_CATEGORIES } from '../../server/email/triage.js';
import {
  computePriorityScore,
  normalizeOverrideKey,
  resolveOverride,
} from '../../server/email/priority.js';
import { parseDigestJson } from '../../server/email/digest.js';
import { parseFollowupJson, normalizeSubject } from '../../server/email/followups.js';
import { parseStyleProfileJson } from '../../server/email/style-profile.js';
import { blendScore, threadEmbedText } from '../../server/email/semantic-search.js';
import {
  isThreadSummaryEligible,
  threadSummaryHash,
} from '../../server/email/thread-summary.js';

describe('triage v2 parsing', () => {
  test('accepts category, deadline, and people', () => {
    const parsed = parseTriageJson(
      JSON.stringify({
        summary: 'Femi needs the contract signed',
        tags: ['contract'],
        urgency: 'high',
        category: 'needs_reply',
        deadline: '2026-07-21',
        people: ['Femi'],
      }),
    );
    assert.equal(parsed.category, 'needs_reply');
    assert.equal(parsed.deadline, '2026-07-21');
    assert.deepEqual(parsed.people, ['Femi']);
  });

  test('defaults invalid category to fyi and drops vague deadlines', () => {
    const parsed = parseTriageJson(
      JSON.stringify({
        summary: 'Weekly digest',
        urgency: 'low',
        category: 'spam-ish',
        deadline: 'next week',
      }),
    );
    assert.equal(parsed.category, 'fyi');
    assert.equal(parsed.deadline, '');
    assert.deepEqual(parsed.people, []);
  });

  test('legacy v1 payloads still parse', () => {
    const parsed = parseTriageJson(
      JSON.stringify({ summary: 'Old style', tags: ['x'], urgency: 'normal' }),
    );
    assert.equal(parsed.summary, 'Old style');
    assert.equal(parsed.category, 'fyi');
  });

  test('category enum is the closed spec set', () => {
    assert.deepEqual(
      [...TRIAGE_CATEGORIES].sort(),
      ['calendar', 'fyi', 'needs_reply', 'newsletter', 'notification', 'receipt', 'security'].sort(),
    );
  });
});

describe('priority heuristic', () => {
  test('needs_reply + high urgency lands in the high bucket', () => {
    const { score, bucket } = computePriorityScore({
      urgency: 'high',
      category: 'needs_reply',
    });
    assert.equal(bucket, 'high');
    assert.ok(score >= 60);
  });

  test('newsletters sink to low', () => {
    const { bucket } = computePriorityScore({ urgency: 'low', category: 'newsletter' });
    assert.equal(bucket, 'low');
  });

  test('sender the user replies to outranks a stranger', () => {
    const stranger = computePriorityScore({ urgency: 'normal', category: 'fyi' });
    const friend = computePriorityScore({
      urgency: 'normal',
      category: 'fyi',
      repliedCount: 10,
    });
    assert.ok(friend.score > stranger.score);
  });

  test('imminent deadline raises the score more than a distant one', () => {
    const nowMs = Date.parse('2026-07-19T00:00:00Z');
    const soon = computePriorityScore({
      urgency: 'normal',
      category: 'fyi',
      deadline: '2026-07-20',
      nowMs,
    });
    const far = computePriorityScore({
      urgency: 'normal',
      category: 'fyi',
      deadline: '2026-09-01',
      nowMs,
    });
    assert.ok(soon.score > far.score);
  });

  test('user override beats everything the model said', () => {
    const pinnedLow = computePriorityScore({
      urgency: 'high',
      category: 'security',
      override: 'low',
    });
    assert.equal(pinnedLow.bucket, 'low');

    const pinnedHigh = computePriorityScore({
      urgency: 'low',
      category: 'newsletter',
      override: 'high',
    });
    assert.equal(pinnedHigh.bucket, 'high');
  });

  test('override keys normalize headers and domains', () => {
    assert.equal(normalizeOverrideKey('Alice <Alice@Example.COM>'), 'alice@example.com');
    assert.equal(normalizeOverrideKey('@example.com'), '@example.com');
    assert.equal(normalizeOverrideKey('not-an-address'), '');
  });

  test('domain override applies when no exact match exists', () => {
    const overrides = new Map([
      ['@corp.com', 'low'],
      ['boss@corp.com', 'high'],
    ]);
    assert.equal(resolveOverride(overrides, 'boss@corp.com'), 'high');
    assert.equal(resolveOverride(overrides, 'noreply@corp.com'), 'low');
    assert.equal(resolveOverride(overrides, 'other@else.com'), '');
  });
});

describe('narrative digest parsing', () => {
  const validIds = new Set(['INBOX:1', 'INBOX:2', 'INBOX:3']);
  const threads = new Map([
    ['INBOX:1', 't-1'],
    ['INBOX:2', 't-2'],
    ['INBOX:3', 't-2'],
  ]);

  test('parses narrative and validates group message ids', () => {
    const parsed = parseDigestJson(
      JSON.stringify({
        narrative: 'Femi needs the contract signed today; two CI alerts can be archived.',
        actionGroups: [
          {
            label: 'Archive 2 alerts',
            action: 'archive',
            messageIds: ['INBOX:2', 'INBOX:3', 'INBOX:999'],
          },
        ],
      }),
      validIds,
      threads,
    );
    assert.ok(parsed.narrative.startsWith('Femi'));
    assert.equal(parsed.actionGroups.length, 1);
    assert.deepEqual(parsed.actionGroups[0].messageIds, ['INBOX:2', 'INBOX:3']);
    assert.deepEqual(parsed.actionGroups[0].threadIds, ['t-2']);
    assert.ok(parsed.actionGroups[0].id, 'groups get stable ids for the queue route');
  });

  test('drops groups that are empty after id validation or carry bad actions', () => {
    const parsed = parseDigestJson(
      JSON.stringify({
        narrative: 'Quiet day.',
        actionGroups: [
          { label: 'Hallucinated', action: 'archive', messageIds: ['NOPE:1'] },
          { label: 'Delete all', action: 'delete', messageIds: ['INBOX:1'] },
        ],
      }),
      validIds,
      threads,
    );
    assert.equal(parsed.actionGroups.length, 0, 'delete and unknown ids never survive');
  });

  test('rejects output without a narrative', () => {
    assert.equal(parseDigestJson(JSON.stringify({ actionGroups: [] }), validIds, threads), null);
  });

  test('unwraps fenced JSON', () => {
    const parsed = parseDigestJson(
      '```json\n{"narrative":"All quiet.","actionGroups":[]}\n```',
      validIds,
      threads,
    );
    assert.equal(parsed.narrative, 'All quiet.');
  });
});

describe('follow-up classification parsing', () => {
  test('parses a positive classification with a day window', () => {
    const parsed = parseFollowupJson('{"expectsReply": true, "expectedByDays": 5}');
    assert.deepEqual(parsed, { expectsReply: true, expectedByDays: 5 });
  });

  test('clamps nonsense day windows to the default', () => {
    assert.equal(parseFollowupJson('{"expectsReply": true, "expectedByDays": 90}').expectedByDays, 3);
    assert.equal(parseFollowupJson('{"expectsReply": true}').expectedByDays, 3);
  });

  test('rejects non-boolean payloads', () => {
    assert.equal(parseFollowupJson('{"expectsReply": "yes"}'), null);
    assert.equal(parseFollowupJson('nonsense'), null);
  });

  test('subject normalization strips stacked reply prefixes', () => {
    assert.equal(normalizeSubject('Re: RE: Fwd: Budget'), 'budget');
    assert.equal(normalizeSubject('Budget'), 'budget');
  });
});

describe('style profile parsing', () => {
  test('parses a full card and caps traits', () => {
    const parsed = parseStyleProfileJson(
      JSON.stringify({
        greeting: 'Hi <name>,',
        signoff: 'Best, Henri',
        formality: 'casual but precise',
        traits: ['short sentences', 'no emoji', 'direct asks', 'a', 'b', 'c'],
      }),
    );
    assert.equal(parsed.greeting, 'Hi <name>,');
    assert.equal(parsed.traits.length, 5);
  });

  test('rejects an empty card', () => {
    assert.equal(parseStyleProfileJson('{"greeting":"","traits":[]}'), null);
  });
});

describe('semantic rerank scoring', () => {
  test('blend favors semantic similarity at high blend weight', () => {
    const semanticWin = blendScore(0.9, 5, 6, 0.9);
    const ftsWin = blendScore(-0.5, 0, 6, 0.9);
    assert.ok(semanticWin > ftsWin);
  });

  test('blend weight 0 preserves FTS order exactly', () => {
    const first = blendScore(0.1, 0, 3, 0);
    const last = blendScore(0.99, 2, 3, 0);
    assert.ok(first > last);
  });

  test('thread embed text prefers the summary over the snippet', () => {
    assert.equal(
      threadEmbedText({ subject: 'S', summary: 'the gist', snippet: 'raw preview' }),
      'S\nthe gist',
    );
    assert.equal(threadEmbedText({ subject: 'S', snippet: 'raw preview' }), 'S\nraw preview');
  });
});

describe('thread summary eligibility', () => {
  test('short threads are not eligible', () => {
    assert.equal(
      isThreadSummaryEligible([{ bodyText: 'hi' }, { bodyText: 'yo' }]),
      false,
    );
  });

  test('more than three messages qualifies', () => {
    assert.equal(
      isThreadSummaryEligible([{}, {}, {}, {}]),
      true,
    );
  });

  test('one very long mail qualifies by word count', () => {
    const words = Array.from({ length: 1600 }, (_, i) => `w${i}`).join(' ');
    assert.equal(isThreadSummaryEligible([{ bodyText: words }]), true);
  });

  test('hash changes only when the thread content changes', () => {
    const thread = [
      { id: 'INBOX:1', bodyHash: 'a' },
      { id: 'INBOX:2', bodyHash: 'b' },
    ];
    const before = threadSummaryHash(thread);
    assert.equal(threadSummaryHash(thread), before);
    assert.notEqual(threadSummaryHash([...thread, { id: 'INBOX:3', bodyHash: 'c' }]), before);
  });
});
