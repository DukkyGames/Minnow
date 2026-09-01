/**
 * P8-C — journal event schema and versioned envelope.
 *
 * Same discipline as P0-B: known shapes validated field by field, unknown
 * types carried through, no intent-named types except `run.requested` which
 * records a completed spawn (see events.js).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ATTEMPT_OUTCOMES,
  ENVELOPE_VERSION,
  EVENT_SCHEMAS,
  EVENT_TYPES,
  isKnownEventType,
  makeEvent,
  SUB_AGENT_ROLE,
  validateEvent,
} from '../../server/sub-agents/events.js';

/** One valid instance of every event type. */
const SAMPLES = {
  'run.requested': {
    runId: 'r1',
    agentType: 'explore',
    task: 'find the helper',
    parentChatId: 'chat-1',
    cwd: '/tmp/ws',
    requestedAt: 1_700_000_000_000,
  },
  'attempt.started': {
    runId: 'r1',
    attemptId: 'a1',
    seed: { kind: 'initial' },
  },
  'attempt.ended': {
    runId: 'r1',
    attemptId: 'a1',
    outcome: 'pass',
  },
  'run.abandoned': { runId: 'r1', reason: 'failed' },
  'run.cancelled': { runId: 'r1', reason: 'user' },
  'result.delivered': { runId: 'r1', parentChatId: 'chat-1' },
  'run.nudged': { runId: 'r1', parentChatId: 'chat-1' },
};

/** @param {string} type */
const sample = (type) => makeEvent(type, { ...SAMPLES[type] });

describe('sub-agent event vocabulary', () => {
  it('declares exactly the seven types', () => {
    assert.equal(EVENT_TYPES.length, 7);
    assert.deepEqual(EVENT_TYPES, Object.keys(SAMPLES));
  });

  it('names no pending/starting/will intent, and only run.requested ends in .requested', () => {
    for (const type of EVENT_TYPES) {
      assert.doesNotMatch(type, /\.(pending|starting|will)$/, `${type} names an intent`);
    }
    const requested = EVENT_TYPES.filter((t) => t.endsWith('.requested'));
    assert.deepEqual(requested, ['run.requested']);
  });

  it('pins the worker role and the six-way outcome union', () => {
    assert.equal(SUB_AGENT_ROLE, 'sub-agent');
    assert.deepEqual([...ATTEMPT_OUTCOMES], [
      'pass',
      'fail',
      'blocked',
      'no_report',
      'crashed',
      'timeout',
    ]);
    assert.equal(ENVELOPE_VERSION, 1);
  });

  it('does not dump its types into board EVENT_SCHEMAS', async () => {
    const board = await import('../../server/orchestrator/core/events.js');
    for (const type of EVENT_TYPES) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(board.EVENT_SCHEMAS, type),
        false,
        `${type} leaked into board EVENT_SCHEMAS`,
      );
    }
  });

  it('recognises known types and only known types', () => {
    for (const type of EVENT_TYPES) assert.equal(isKnownEventType(type), true);
    assert.equal(isKnownEventType('some.future.event'), false);
    assert.equal(isKnownEventType('task.attempt.started'), false);
    assert.equal(isKnownEventType('toString'), false);
  });
});

describe('validateEvent — happy path', () => {
  for (const type of EVENT_TYPES) {
    it(`accepts a well-formed ${type}`, () => {
      const result = validateEvent({ ...sample(type), seq: 7, ts: 1_700_000_000_000 });
      assert.equal(result.ok, true);
      assert.equal(result.known, true);
    });
  }

  it('round-trips every event through JSON unchanged', () => {
    for (const type of EVENT_TYPES) {
      const event = { ...sample(type), seq: 1, ts: 1 };
      assert.deepEqual(JSON.parse(JSON.stringify(event)), event);
    }
  });

  it('accepts optional fields when present and when absent', () => {
    assert.equal(
      validateEvent(
        makeEvent('attempt.started', {
          ...SAMPLES['attempt.started'],
          seedKind: 'continue',
          model: { providerId: 'local', id: 'm1' },
        }),
      ).ok,
      true,
    );
    assert.equal(
      validateEvent(
        makeEvent('attempt.ended', {
          ...SAMPLES['attempt.ended'],
          summary: '',
          evidence: { transcriptTail: '…' },
          usage: { promptTokens: 1 },
        }),
      ).ok,
      true,
    );
  });

  it('rejects an optional field of the wrong type', () => {
    const bad = validateEvent(
      makeEvent('attempt.ended', {
        ...SAMPLES['attempt.ended'],
        evidence: 'not-an-object',
      }),
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'attempt.ended.evidence: must be an object');
  });
});

describe('validateEvent — one test per required field', () => {
  for (const type of EVENT_TYPES) {
    for (const field of Object.keys(EVENT_SCHEMAS[type].required)) {
      it(`rejects ${type} missing ${field}`, () => {
        const payload = { ...SAMPLES[type] };
        delete payload[field];
        const result = validateEvent(makeEvent(type, payload));
        assert.equal(result.ok, false);
        assert.match(result.error, new RegExp(`${type}\\.${field}`));
      });
    }
  }
});

describe('validateEvent — envelope and tolerance', () => {
  it('rejects a non-object', () => {
    assert.equal(validateEvent(null).ok, false);
    assert.equal(validateEvent('x').ok, false);
  });

  it('rejects a missing type', () => {
    const result = validateEvent({ v: 1, runId: 'r1' });
    assert.equal(result.ok, false);
  });

  it('tolerates an unknown type', () => {
    const result = validateEvent({ v: 1, type: 'agents.future', seq: 1, ts: 1, extra: true });
    assert.equal(result.ok, true);
    assert.equal(result.known, false);
  });

  it('rejects a known event that is malformed rather than treating it as unknown', () => {
    const result = validateEvent({ v: 1, type: 'run.cancelled', runId: 'r1', reason: 'timeout' });
    assert.equal(result.ok, false);
  });

  it('makeEvent does not let a payload overwrite the discriminant', () => {
    const event = makeEvent('run.requested', {
      ...SAMPLES['run.requested'],
    });
    assert.equal(event.type, 'run.requested');
    assert.equal(event.agentType, 'explore');
  });
});
