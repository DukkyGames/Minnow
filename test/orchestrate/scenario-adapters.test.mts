import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getBoardScenario,
  toFakeModelScenario,
  toScenarioValidationPlan,
  type FakeModelScenarioStep,
} from '../../src/dev/orchestrate-scenarios/index.ts';
import { normalizeScenario } from '../../scripts/fake-model-server.mjs';

function scenario(id: string) {
  const value = getBoardScenario(id);
  assert.ok(value, `missing built-in scenario ${id}`);
  return value;
}

function stepFor(
  steps: FakeModelScenarioStep[],
  role: string,
  taskId: string | undefined,
  nth: number | undefined,
): FakeModelScenarioStep | undefined {
  return steps.find(
    (step) =>
      step.match?.role === role &&
      step.match?.taskId === taskId &&
      step.match?.nth === nth,
  );
}

function firstDelta(step: FakeModelScenarioStep): Record<string, unknown> {
  const data = step.emit[0]?.match(/^data: (.+)\n\n$/)?.[1];
  assert.ok(data, 'expected a data SSE chunk');
  return JSON.parse(data);
}

describe('orchestrate scenario adapters', () => {
  test('produces valid ordered fake-model match/emit steps for the happy preset', () => {
    const adapted = toFakeModelScenario(scenario('happy.quick'));
    assert.equal(adapted.steps.length, 11);
    assert.deepEqual(normalizeScenario({ steps: adapted.steps }), adapted.steps);

    const builder = stepFor(adapted.steps, 'builder', 'W1-A', 0);
    assert.ok(builder);
    const delta = firstDelta(builder) as {
      choices: Array<{
        delta: {
          tool_calls: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
    };
    const tool = delta.choices[0].delta.tool_calls[0];
    assert.equal(tool.function.name, 'board_report');
    assert.deepEqual(JSON.parse(tool.function.arguments), {
      task_id: 'W1-A',
      outcome: 'pass',
      summary: 'Scenario adapter: board_report pass for W1-A',
    });
    assert.match(builder.emit[1], /"finish_reason":"tool_calls"/);
    assert.equal(builder.emit[2], 'event: end\ndata: {"status":"complete"}\n\n');

    const ack = stepFor(adapted.steps, 'builder', 'W1-A', 1);
    assert.ok(ack);
    assert.match(ack.emit[1], /"finish_reason":"stop"/);
  });

  test('orders recoverable and terminal missing-report behavior before baseline steps', () => {
    const recover = toFakeModelScenario(scenario('report.builder-missing-recover'));
    assert.deepEqual(recover.steps[0].match, {
      role: 'builder',
      taskId: 'W1-A',
      nth: 0,
    });
    assert.match(JSON.stringify(firstDelta(recover.steps[0])), /READY FOR VERIFICATION/);
    const recoveryReport = stepFor(recover.steps, 'builder', 'W1-A', 1);
    assert.ok(recoveryReport);
    assert.match(JSON.stringify(firstDelta(recoveryReport)), /board_report/);

    const terminal = toFakeModelScenario(scenario('report.builder-missing-terminal'));
    assert.deepEqual(terminal.steps[0].match, {
      role: 'builder',
      taskId: 'W1-A',
    });
    assert.match(JSON.stringify(firstDelta(terminal.steps[0])), /READY FOR VERIFICATION/);
  });

  test('scripts tester failure followed by deterministic build and verdict recovery', () => {
    const adapted = toFakeModelScenario(scenario('verdict.tester-recover'));
    assert.deepEqual(adapted.steps[0].match, {
      role: 'tester',
      taskId: 'W1-A',
      nth: 0,
    });
    assert.match(JSON.stringify(firstDelta(adapted.steps[0])), /VERDICT: fail/);
    assert.ok(stepFor(adapted.steps, 'builder', 'W1-A', 2));
    const testerPass = stepFor(adapted.steps, 'tester', 'W1-A', 1);
    assert.ok(testerPass);
    assert.match(JSON.stringify(firstDelta(testerPass)), /VERDICT: pass/);
  });

  test('derives detached validation-plan data from quick and smoke preset graphs', () => {
    const quick = toScenarioValidationPlan(scenario('happy.quick'));
    const smoke = toScenarioValidationPlan(scenario('happy.smoke'));
    assert.deepEqual(quick.boardLog.waveOrder, ['W1']);
    assert.deepEqual(
      quick.boardLog.tasks.map((task) => task.id),
      ['W1-A', 'W1-B', 'W1-C'],
    );
    assert.deepEqual(smoke.boardLog.waveOrder, ['W1', 'W2', 'W3']);
    assert.deepEqual(
      smoke.boardLog.tasks.find((task) => task.id === 'W2-A')?.dependsOn,
      ['W1-A', 'W1-B'],
    );
    assert.equal(smoke.boardLog.expectFinalTest, true);

    quick.graph.tasks[0].id = 'changed';
    const replay = toScenarioValidationPlan(scenario('happy.quick'));
    assert.equal(replay.graph.tasks[0].id, 'W1-A');
  });
});
