/**
 * Bootstrap work agents for headless CLI via GET /api/work-agents (no Vite glob).
 */

import registryIndex from '../chat/prompts/work-agents/registry.json';
import {
  registerWorkAgentsFromServerSnapshot,
  setUserWorkAgentOverrides,
  setWorkAgentRegistryIndex,
} from '../agents/work-agent-registry';
import type { WorkAgentDefinition, WorkAgentUserOverride } from '../agents/work-agent-types';

/** Load agent registry from the dev server (requires npm start). */
export async function initHeadlessWorkAgents(): Promise<void> {
  setWorkAgentRegistryIndex(registryIndex as { ids: string[] });

  const res = await fetch('/api/work-agents', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `Failed to load work agents (HTTP ${res.status}). Start the dev server with npm start.`,
    );
  }

  const body = (await res.json()) as {
    agents?: WorkAgentDefinition[];
    overrides?: Record<string, WorkAgentUserOverride>;
  };

  if (!Array.isArray(body.agents) || body.agents.length === 0) {
    throw new Error('Work agent registry empty — is npm start running?');
  }

  registerWorkAgentsFromServerSnapshot(body.agents);
  if (body.overrides) {
    setUserWorkAgentOverrides(body.overrides);
  }
}
