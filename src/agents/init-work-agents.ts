import { BUILTIN_RAW } from '../chat/prompts/builtin-globs';
import registryIndex from '../chat/prompts/work-agents/registry.json';
import {
  initBuiltinWorkAgentRegistry,
  registerPackAgentsFromApi,
  setUserWorkAgentOverrides,
  setWorkAgentRegistryIndex,
} from './work-agent-registry';
import type { WorkAgentDefinition, WorkAgentUserOverride } from './work-agent-types';

export async function initWorkAgentSystem(): Promise<void> {
  setWorkAgentRegistryIndex(registryIndex as { ids: string[] });

  const workAgentRaw: Record<string, string> = {};
  for (const [globPath, content] of Object.entries(BUILTIN_RAW)) {
    if (globPath.includes('work-agents/')) {
      workAgentRaw[globPath] = content;
    }
  }
  initBuiltinWorkAgentRegistry(workAgentRaw);

  try {
    const res = await fetch('/api/work-agents', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as {
      agents?: WorkAgentDefinition[];
      overrides?: Record<string, WorkAgentUserOverride>;
    };
    if (Array.isArray(body.agents)) {
      registerPackAgentsFromApi(body.agents);
    }
    if (body.overrides) {
      setUserWorkAgentOverrides(body.overrides);
    }
  } catch {}
}
