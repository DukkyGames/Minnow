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

/** Trigger a browser download for an agent-pack zip endpoint. */
async function downloadAgentPackArchive(
  path: string,
  fallbackFilename: string,
): Promise<true | Error> {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) {
      let message = 'Could not download agent pack';
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* non-JSON error body */
      }
      return new Error(message);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? fallbackFilename;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}

/** GET /api/agent-packs/template — authenticated fetch + browser save dialog. */
export async function downloadAgentPackTemplate(): Promise<true | Error> {
  return downloadAgentPackArchive(
    '/api/agent-packs/template',
    'minnow-agent-pack-template.zip',
  );
}

/** GET /api/agent-packs/builtin — shipped work agents as a customizable pack. */
export async function downloadBuiltinAgentPack(): Promise<true | Error> {
  return downloadAgentPackArchive(
    '/api/agent-packs/builtin',
    'minnow-default-agent-pack.zip',
  );
}
