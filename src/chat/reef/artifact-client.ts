/**
 * Browser client for /api/reef/artifacts (versioned ~/.minnow store).
 */

export interface ReefArtifactManifest {
  id: string;
  title: string;
  currentVersion: number;
  refs: string[];
  chatIds?: string[];
  widgetBindings?: Array<{ messageId?: string; widgetId?: string }>;
  createdAt: string;
  updatedAt: string;
  source?: {
    type: 'tool' | 'widget' | 'agent';
    toolName?: string;
    messageId?: string;
    widgetId?: string;
    toolCallId?: string;
  };
}

export interface ReefArtifactVersionRow {
  manifest: ReefArtifactManifest;
  version: number;
  meta: Record<string, string>;
  body: string;
  raw?: string;
}

export interface AppendArtifactVersionResult {
  manifest: ReefArtifactManifest;
  version: number;
  path: string;
}

async function reefJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    const message =
      typeof (data as { error?: string }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

/** List artifact manifests (paginated). */
export async function listReefArtifacts(opts?: {
  limit?: number;
  offset?: number;
}): Promise<ReefArtifactManifest[]> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  const qs = params.toString();
  const data = await reefJson<{ artifacts: ReefArtifactManifest[] }>(
    `/api/reef/artifacts${qs ? `?${qs}` : ''}`,
  );
  return data.artifacts;
}

/** Read manifest + current body. */
export async function getReefArtifact(id: string): Promise<ReefArtifactVersionRow> {
  return reefJson<ReefArtifactVersionRow>(`/api/reef/artifacts/${encodeURIComponent(id)}`);
}

/** Read a specific version. */
export async function getReefArtifactVersion(
  id: string,
  version: number,
): Promise<ReefArtifactVersionRow> {
  return reefJson<ReefArtifactVersionRow>(
    `/api/reef/artifacts/${encodeURIComponent(id)}/versions/${version}`,
  );
}

/** Create artifact with v1. */
export async function createReefArtifact(opts: {
  id?: string;
  title: string;
  body: string;
  author?: string;
  refs?: string[];
  source?: ReefArtifactManifest['source'];
  chatIds?: string[];
}): Promise<{ id: string; manifest: ReefArtifactManifest; body: string }> {
  return reefJson('/api/reef/artifacts', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

/** Append version (monotonic). */
export async function appendReefArtifactVersion(
  id: string,
  opts: {
    body: string;
    author?: string;
    refs?: string[];
    summary?: string;
    expectedVersion?: number;
  },
): Promise<AppendArtifactVersionResult> {
  return reefJson<AppendArtifactVersionResult>(`/api/reef/artifacts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(opts),
  });
}
