/**
 * Leading-assistant fold on the P6 chat path (continues MIN-725/MIN-726).
 *
 * `buildApiMessages` ended with
 * `repairUnpairedToolCalls(foldLeadingAssistantPreamble(messages))`. P6 routed
 * product chat through `runTurn({ seedKind: 'continue' })`, which reads prior
 * rows straight off `chat.history`. The runner kept the repair half
 * (`sub-agent-runner.js`, top of every loop iteration) but nothing folded, so
 * an expert chat — whose history opens with the authored assistant greeting
 * from `createExpertChatFromSeed` — sent a transcript whose first non-system
 * row was `assistant`: the "already greeted in the UI" instruction was gone
 * and user-first providers reject that body.
 *
 * The fold now lives in `buildOpeningTranscript`, so board and chat callers
 * both get it. Folding removes a row and the appended seed row adds one, so
 * the opening is no longer `1 + prior.length`; `persistFrom` carries the
 * boundary `runTurn` must suffix from. This file covers the shape; the
 * end-to-end persist proof lives in `run-turn.test.mjs` beside the other
 * continuation tests.
 *
 * Plain `node --test`, like the rest of `test/runner/`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildOpeningMessages,
  buildOpeningTranscript,
} from '../../server/runner/index.js';

const GREETING = 'Hi — I am **Security reviewer**. What are we looking at?';
/** Text `foldLeadingAssistantPreamble` splices into the system row. */
const FOLD_NOTE = /already greeted the user in the UI/;

describe('buildOpeningMessages folds a leading assistant greeting', () => {
  test('expert-shaped prior opens on user, greeting moves into system', () => {
    const opened = buildOpeningMessages('You are Security reviewer.', 'second', [
      { role: 'assistant', content: GREETING },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'looked at it' },
    ]);

    assert.equal(opened[0].role, 'system');
    assert.match(opened[0].content, /You are Security reviewer\./);
    assert.match(opened[0].content, FOLD_NOTE);
    assert.match(opened[0].content, /Security reviewer\*\*/, 'greeting text is carried along');
    assert.deepEqual(
      opened.slice(1).map((m) => m.role),
      ['user', 'assistant', 'user'],
      'the conversation must open on a user turn',
    );
    // Folding removes a row: 1 system + 3 prior + 1 seed - 1 folded.
    assert.equal(opened.length, 4);
  });

  test('a stored leading system is dropped before the greeting is folded', () => {
    const opened = buildOpeningMessages('new-sys', 'ask', [
      { role: 'system', content: 'old-sys' },
      { role: 'assistant', content: GREETING },
      { role: 'user', content: 'first' },
    ]);

    assert.equal(opened.length, 3);
    assert.equal(opened[0].role, 'system');
    assert.match(opened[0].content, /^new-sys/, 'this turn systemPrompt still wins');
    assert.equal(opened[0].content.includes('old-sys'), false);
    assert.match(opened[0].content, FOLD_NOTE);
    assert.deepEqual(
      opened.slice(1).map((m) => m.role),
      ['user', 'user'],
    );
  });

  test('user-first histories and isolated openings are untouched', () => {
    const prior = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'hi' },
    ];
    const continued = buildOpeningMessages('sys', 'second', prior);
    assert.equal(continued.length, 4);
    assert.equal(continued[0].content, 'sys', 'no fold note on a user-first history');
    assert.deepEqual(continued.slice(1, 3), prior);

    const isolated = buildOpeningMessages('sys', 'only seed');
    assert.deepEqual(isolated, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'only seed' },
    ]);
  });

  test('a trailing assistant run is left alone — only the preamble folds', () => {
    const opened = buildOpeningMessages('sys', '', [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    assert.deepEqual(
      opened.map((m) => m.role),
      ['system', 'user', 'assistant', 'assistant'],
    );
  });
});

describe('buildOpeningTranscript persistFrom boundary', () => {
  /** `persistFrom` must point at the first row the store does not already hold. */
  const cases = [
    {
      what: 'folded greeting, seed already stored',
      prior: [
        { role: 'assistant', content: GREETING },
        { role: 'user', content: 'audit this' },
      ],
      seed: 'audit this',
      // [system', user] — both prior rows accounted for, nothing new yet.
      persistFrom: 2,
    },
    {
      what: 'folded greeting, seed appended',
      prior: [{ role: 'assistant', content: GREETING }],
      seed: 'audit this',
      // [system', user(seed)] — the seed row is new and must be persisted.
      persistFrom: 1,
    },
    {
      what: 'no fold, seed appended',
      prior: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'hi' },
      ],
      seed: 'second',
      // [system, user, assistant, user(seed)] — index 3 is the new seed row.
      persistFrom: 3,
    },
    {
      what: 'no fold, seed already stored',
      prior: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'second' },
      ],
      seed: 'second',
      persistFrom: 4,
    },
    {
      what: 'stored leading system is not a persistable row',
      prior: [
        { role: 'system', content: 'old-sys' },
        { role: 'assistant', content: GREETING },
        { role: 'user', content: 'first' },
      ],
      seed: 'first',
      // Prior contributes system (dropped) + greeting (folded) + user.
      persistFrom: 2,
    },
  ];

  for (const { what, prior, seed, persistFrom } of cases) {
    test(what, () => {
      const opened = buildOpeningTranscript('sys', seed, prior);
      assert.equal(opened.persistFrom, persistFrom);
      assert.ok(
        opened.persistFrom <= opened.messages.length,
        'the boundary must fall inside the opening',
      );
      assert.deepEqual(opened.messages, buildOpeningMessages('sys', seed, prior));
    });
  }
});
