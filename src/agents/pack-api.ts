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
      } catch {}
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

export async function downloadAgentPackTemplate(): Promise<true | Error> {
  return downloadAgentPackArchive(
    '/api/agent-packs/template',
    'minnow-agent-pack-template.zip',
  );
}

export async function downloadBuiltinAgentPack(): Promise<true | Error> {
  return downloadAgentPackArchive(
    '/api/agent-packs/builtin',
    'minnow-default-agent-pack.zip',
  );
}

export type AgentPackUploadResult =
  | { ok: true; pack: AgentPackListItem; filesWritten: number; packRoot: string }
  | { ok: false; error: string };

export async function uploadAgentPackZip(file: File): Promise<AgentPackUploadResult> {
  const form = new FormData();
  form.append('file', file, file.name);

  try {
    const res = await fetch('/api/agent-packs/upload', {
      method: 'POST',
      body: form,
    });
    const body = (await res.json()) as {
      error?: string;
      pack?: AgentPackListItem;
      filesWritten?: number;
      packRoot?: string;
    };
    if (!res.ok) {
      return { ok: false, error: body.error ?? 'Could not install agent pack' };
    }
    if (!body.pack || typeof body.filesWritten !== 'number' || !body.packRoot) {
      return { ok: false, error: 'Invalid install response from server' };
    }
    return {
      ok: true,
      pack: body.pack,
      filesWritten: body.filesWritten,
      packRoot: body.packRoot,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
