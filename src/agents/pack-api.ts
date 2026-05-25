/**
 * Client fetch helpers for /api/agent-packs.
 */

import type { AgentPackListItem } from './pack-types';

export async function fetchAgentPacksList(): Promise<AgentPackListItem[]> {
  const res = await fetch('/api/agent-packs', { cache: 'no-store' });
  if (!res.ok) return [];
  const body = (await res.json()) as { packs?: AgentPackListItem[] };
  return Array.isArray(body.packs) ? body.packs : [];
}

export async function patchAgentPackEnabled(
  packId: string,
  enabled: boolean,
): Promise<AgentPackListItem | null> {
  const res = await fetch(`/api/agent-packs/${encodeURIComponent(packId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { pack?: AgentPackListItem };
  return body.pack ?? null;
}
