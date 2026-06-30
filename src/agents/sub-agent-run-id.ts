/**
 * Run id generation for sub-agents (injectable in tests).
 */

import { randomUUID } from '../lib/random-id.ts';

let runIdFactory: () => string = () => randomUUID();

/** Override run id generation (tests use fixed UUID). */
export function setSubAgentRunIdFactory(factory: () => string): void {
  runIdFactory = factory;
}

/** Reset to default randomUUID(). */
export function resetSubAgentRunIdFactory(): void {
  runIdFactory = () => randomUUID();
}

/** Create a new sub-agent run id. */
export function createSubAgentRunId(): string {
  return runIdFactory();
}
