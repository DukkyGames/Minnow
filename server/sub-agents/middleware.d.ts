import type { Effector, Engine } from '../orchestrator/engine';
import type { RunState } from './types';

export const ROUTES: Array<{ method: string; pattern: RegExp; name: string }>;
export const MUTATING_ROUTES: Set<string>;

export function matchRoute(
  method: string,
  pathname: string,
): { name: string; params: string[] } | null;

export function setAgentsEffectorFactory(
  factory: (parentChatId: string) => Effector,
): void;

export function getAgentsEngine(parentChatId: string): Promise<Engine>;

export function statusFromPhase(
  run: RunState,
): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export function handleAgentsRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  pathname: string,
): Promise<boolean>;

export function createAgentsMiddleware(): (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  next: () => void,
) => Promise<void>;

export function resetAgentsMiddlewareForTests(): void;

export { disposeEngines } from '../orchestrator/engine';
