/**
 * Renderer adapter for the shared sub-agent runner (MIN-698).
 *
 * The turn loop lives in `server/runner/`. This file injects the existing
 * renderer I/O (session store, `/api/generations`, headless tool batch) so
 * normal chat's sub-agents keep working unchanged.
 *
 * Import from `server/runner/index.js` (isomorphic). Do not import
 * `server/runner/node.js` — Vite follows that barrel into the tool server.
 *
 * P6-A: `createSessionTranscriptStore` and `createRendererRunnerDeps` are
 * shared with the chat spike (`src/chat/run-turn-chat.ts`).
 */

import { createSubAgentRunner, cloneSubAgentMessages } from '../../server/runner/index.js';
import type { SubAgentRunner } from './types';
import { createRendererRunnerDeps } from './renderer-runner-deps';

export { cloneSubAgentMessages };
export { createSessionTranscriptStore } from './session-transcript-store';

/** Inner instance — created on first use so module load cannot race `__name`. */
let defaultInnerRunner: SubAgentRunner | null = null;

function getDefaultInnerRunner(): SubAgentRunner {
  if (!defaultInnerRunner) {
    defaultInnerRunner = createSubAgentRunner(createRendererRunnerDeps());
  }
  return defaultInnerRunner;
}

/**
 * Default runner: LM Studio stream + nested tools, wired to renderer stores.
 * Facade so import identity stays stable without constructing at module load
 * (attachments → UI → this file used to TDZ `tsx`'s `__name` helper).
 */
export const defaultSubAgentRunner: SubAgentRunner = {
  run: (input) => getDefaultInnerRunner().run(input),
};

let runnerFactory: () => SubAgentRunner = () => defaultSubAgentRunner;

/** Inject mock runner for deterministic tests. */
export function setSubAgentRunnerFactory(factory: () => SubAgentRunner): void {
  runnerFactory = factory;
}

export function resetSubAgentRunnerFactory(): void {
  runnerFactory = () => defaultSubAgentRunner;
}

/** Resolve active runner implementation. */
export function getSubAgentRunner(): SubAgentRunner {
  return runnerFactory();
}
