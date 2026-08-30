import type { RunnerDeps } from './adapters';
import type { SubAgentRunner } from '../../src/agents/types';
import type { ApiMessage } from '../../src/types';

export function createSubAgentRunner(deps: RunnerDeps): SubAgentRunner;
export function cloneSubAgentMessages(messages: ApiMessage[]): ApiMessage[];
