/**
 * Run id generation for sub-agents (injectable in tests).
 */

let runIdFactory: () => string = () => crypto.randomUUID();

/** Override run id generation (tests use fixed UUID). */
export function setSubAgentRunIdFactory(factory: () => string): void {
  runIdFactory = factory;
}

/** Reset to default crypto.randomUUID(). */
export function resetSubAgentRunIdFactory(): void {
  runIdFactory = () => crypto.randomUUID();
}

/** Create a new sub-agent run id. */
export function createSubAgentRunId(): string {
  return runIdFactory();
}
