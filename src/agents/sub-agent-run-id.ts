import { randomUUID } from '../lib/random-id.ts';

let runIdFactory: () => string = () => randomUUID();

export function setSubAgentRunIdFactory(factory: () => string): void {
  runIdFactory = factory;
}

export function resetSubAgentRunIdFactory(): void {
  runIdFactory = () => randomUUID();
}

export function createSubAgentRunId(): string {
  return runIdFactory();
}
