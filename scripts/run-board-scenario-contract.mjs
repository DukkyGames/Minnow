import { importTsModule } from '../server/orchestrate/board-testing/ts-import.js';
import {
  BOARD_GATE_EXIT,
  BoardGateError,
  isMain,
  parseBoardGateArgs,
  runBoardGateMain,
} from './run-board-cli.mjs';

const MAX_ADAPTER_BYTES = 2_000_000;

export async function validateScenarioContracts() {
  const {
    getBoardScenario,
    listBoardScenarioMetadata,
    parseBoardScenario,
    toFakeModelScenario,
    toScenarioValidationPlan,
    validateScenarioCatalog,
  } = await importTsModule('../../../src/dev/orchestrate-scenarios/index.ts');
  const metadata = listBoardScenarioMetadata();
  if (metadata.length === 0) {
    throw new BoardGateError('Board scenario catalog is empty', 'contract_failure', BOARD_GATE_EXIT.gateFailure);
  }
  const scenarios = metadata.map((entry) => {
    const scenario = getBoardScenario(entry.id);
    if (!scenario) {
      throw new BoardGateError(
        `Catalog metadata has no scenario: ${entry.id}`,
        'contract_failure',
        BOARD_GATE_EXIT.gateFailure,
      );
    }
    return parseBoardScenario(scenario);
  });
  validateScenarioCatalog(scenarios);

  const checked = scenarios.map((scenario) => {
    const fakeModel = toFakeModelScenario(scenario);
    const validation = toScenarioValidationPlan(scenario);
    if (
      fakeModel.scenarioId !== scenario.id ||
      validation.scenarioId !== scenario.id ||
      fakeModel.seed !== scenario.seed ||
      validation.seed !== scenario.seed
    ) {
      throw new BoardGateError(
        `Scenario adapter identity mismatch: ${scenario.id}`,
        'contract_failure',
        BOARD_GATE_EXIT.gateFailure,
      );
    }
    const first = JSON.stringify({ fakeModel, validation });
    const second = JSON.stringify({
      fakeModel: toFakeModelScenario(parseBoardScenario(scenario)),
      validation: toScenarioValidationPlan(parseBoardScenario(scenario)),
    });
    if (first !== second) {
      throw new BoardGateError(
        `Scenario adapters are non-deterministic: ${scenario.id}`,
        'contract_failure',
        BOARD_GATE_EXIT.gateFailure,
      );
    }
    const bytes = Buffer.byteLength(first);
    if (bytes > MAX_ADAPTER_BYTES) {
      throw new BoardGateError(
        `Scenario adapter output exceeds 2 MB: ${scenario.id}`,
        'contract_failure',
        BOARD_GATE_EXIT.gateFailure,
      );
    }
    return {
      id: scenario.id,
      fakeModelSteps: fakeModel.steps.length,
      tasks: validation.graph.tasks.length,
      bytes,
    };
  });

  return {
    gate: 'scenario-contract',
    classification: 'pass',
    exitCode: BOARD_GATE_EXIT.success,
    scenarioCount: checked.length,
    scenarios: checked,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseBoardGateArgs(argv, {
    help: { type: 'boolean' },
  });
  if (args.help) {
    return {
      gate: 'scenario-contract',
      classification: 'pass',
      exitCode: BOARD_GATE_EXIT.success,
      usage: 'node --import tsx scripts/run-board-scenario-contract.mjs',
    };
  }
  return validateScenarioContracts();
}

if (isMain(import.meta.url)) {
  await runBoardGateMain(() => main());
}
