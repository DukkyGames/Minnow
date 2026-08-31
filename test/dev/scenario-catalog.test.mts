/**
 * Built-in board-testing scenario catalog (MIN-513).
 *
 * Moved from `test/orchestrate/` in MIN-716. These assert the catalog that
 * Settings → Board testing and `npm run board:scenario-contract` still use —
 * not the deleted V1 engine.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createDeterministicScenarioSeed,
  getBoardScenario,
  getBoardScenarioMetadata,
  listBoardScenarioMetadata,
  parseBoardScenario,
  validateScenarioCatalog,
  validateScenarioGraph,
} from '../../src/dev/orchestrate-scenarios/index.ts';

function validScenario(id = 'test.valid') {
  // `concurrency` replaced V1 `executionMode` (MIN-718). Sequential is N=1.
  return {
    id,
    family: 'test',
    description: 'A valid test scenario.',
    preset: 'quick',
    concurrency: 2,
    seed: 'test-seed',
    expected: { boardOutcome: 'passed' },
    faults: [],
  };
}

describe('orchestrate scenario catalog', () => {
  test('validates every built-in and exposes detached metadata', () => {
    const metadata = listBoardScenarioMetadata();
    assert.deepEqual(
      metadata.map((entry) => entry.id),
      [
        'happy.quick',
        'happy.smoke',
        'report.builder-missing-recover',
        'report.builder-missing-terminal',
        'verdict.tester-recover',
      ],
    );
    for (const entry of metadata) {
      assert.ok(getBoardScenario(entry.id));
      assert.deepEqual(getBoardScenarioMetadata(entry.id), entry);
    }

    metadata[0].tags.push('mutated');
    assert.equal(getBoardScenarioMetadata('happy.quick')?.tags.includes('mutated'), false);
    assert.equal(getBoardScenario('unknown'), undefined);
  });

  test('rejects duplicate scenario, fault, graph task, and graph wave IDs', () => {
    assert.throws(
      () => validateScenarioCatalog([validScenario(), validScenario()]),
      /Duplicate board scenario id "test\.valid"/,
    );
    assert.throws(
      () =>
        parseBoardScenario({
          ...validScenario(),
          faults: [
            {
              id: 'same-fault',
              boundary: 'report_contract',
              target: { role: 'builder', phase: 'build', taskId: 'W1-A' },
              trigger: { kind: 'occurrence', occurrence: 1 },
              action: { kind: 'respond', response: 'builder_report_missing' },
              repeat: false,
              expectedRecovery: 'nudge',
            },
            {
              id: 'same-fault',
              boundary: 'report_contract',
              target: { role: 'builder', phase: 'build', taskId: 'W1-A' },
              trigger: { kind: 'occurrence', occurrence: 2 },
              action: { kind: 'respond', response: 'builder_report_missing' },
              repeat: false,
              expectedRecovery: 'nudge',
            },
          ],
        }),
      /duplicate fault id "same-fault"/,
    );
    assert.throws(
      () =>
        validateScenarioGraph({
          waves: [{ id: 'W1' }],
          tasks: [
            { id: 'W1-A', title: 'A', wave: 'W1' },
            { id: 'W1-A', title: 'B', wave: 'W1' },
          ],
        }),
      /duplicate task id "W1-A"/,
    );
    assert.throws(
      () =>
        validateScenarioGraph({
          waves: [{ id: 'W1' }, { id: 'W1' }],
          tasks: [],
        }),
      /duplicate wave id "W1"/,
    );
  });

  test('strictly rejects invalid and implementation-shaped faults', () => {
    assert.throws(
      () =>
        parseBoardScenario({
          ...validScenario(),
          faults: [
            {
              id: 'bad-occurrence',
              boundary: 'report_contract',
              target: { role: 'builder', phase: 'build', taskId: 'W1-A' },
              trigger: { kind: 'occurrence', occurrence: 0 },
              action: { kind: 'respond', response: 'builder_report_missing' },
              repeat: false,
              expectedRecovery: 'nudge',
            },
          ],
        }),
      /positive integer/,
    );
    assert.throws(
      () =>
        parseBoardScenario({
          ...validScenario(),
          faults: [
            {
              id: 'wrong-role',
              boundary: 'report_contract',
              target: { role: 'tester', phase: 'test', taskId: 'W1-A' },
              trigger: { kind: 'occurrence', occurrence: 1 },
              action: { kind: 'respond', response: 'builder_report_missing' },
              repeat: false,
              expectedRecovery: 'nudge',
            },
          ],
        }),
      /builder responses require the builder role/,
    );
    assert.throws(
      () =>
        parseBoardScenario({
          ...validScenario(),
          faults: [
            {
              id: 'raw-callback',
              boundary: 'report_contract',
              target: { role: 'builder', phase: 'build', taskId: 'W1-A' },
              trigger: { kind: 'callback', occurrence: 1 },
              action: { kind: 'respond', response: 'builder_report_missing' },
              repeat: false,
              expectedRecovery: 'nudge',
            },
          ],
        }),
      /trigger\.kind/,
    );
    assert.throws(
      () => parseBoardScenario({ ...validScenario(), privateCallback: 'onRequest' }),
      /unknown field/,
    );
    // V1 catalog field — concurrency is the only remaining start budget.
    assert.throws(
      () => parseBoardScenario({ ...validScenario(), executionMode: 'afk' }),
      /unknown field/,
    );
  });

  test('replays the same deterministic seed stream', () => {
    const left = createDeterministicScenarioSeed('catalog-seed');
    const right = createDeterministicScenarioSeed('catalog-seed');
    const leftValues = Array.from({ length: 8 }, () => left.nextUint32());
    const rightValues = Array.from({ length: 8 }, () => right.nextUint32());
    assert.deepEqual(leftValues, rightValues);
    assert.deepEqual(
      left.derive('child').pick(['a', 'b', 'c']),
      right.derive('child').pick(['a', 'b', 'c']),
    );
    assert.throws(() => createDeterministicScenarioSeed('  '), /must not be empty/);
  });
});
