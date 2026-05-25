/**
 * Client API for Minnow setup profiles (~/.minnow/profiles).
 */

import type {
  ActivateProfileResult,
  MinnowProfileBundle,
  ProfileListItem,
} from './profile-types';
import { detectConfigServer } from './storage-mode';
import { resetPromptMetaCache } from './prompt-meta';

async function parseApiError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  if (body && typeof body === 'object' && 'error' in body) {
    return String((body as { error: unknown }).error);
  }
  return res.statusText || `HTTP ${res.status}`;
}

/** Whether profile APIs are available (npm start). */
export async function isProfilesServerAvailable(): Promise<boolean> {
  const mode = await detectConfigServer();
  return mode === 'server';
}

/** GET /api/profiles */
export async function listSetupProfiles(): Promise<ProfileListItem[]> {
  try {
    const res = await fetch('/api/profiles', { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { profiles?: ProfileListItem[] };
    return body.profiles ?? [];
  } catch {
    return [];
  }
}

/** GET /api/profiles/:id */
export async function loadSetupProfile(id: string): Promise<MinnowProfileBundle | Error> {
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return new Error(await parseApiError(res));
    return (await res.json()) as MinnowProfileBundle;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}

/** POST /api/profiles/capture */
export async function captureSetupProfile(body: {
  id?: string;
  label?: string;
  description?: string;
}): Promise<MinnowProfileBundle | Error> {
  try {
    const res = await fetch('/api/profiles/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return new Error(await parseApiError(res));
    const json = (await res.json()) as { profile?: MinnowProfileBundle };
    if (!json.profile) return new Error('Capture response missing profile');
    return json.profile;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}

/** POST /api/profiles/:id/activate */
export async function activateSetupProfile(
  id: string,
): Promise<ActivateProfileResult | Error> {
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return new Error(await parseApiError(res));
    const result = (await res.json()) as ActivateProfileResult;
    invalidateCachesAfterProfileActivate();
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}

/** POST /api/profiles/import */
export async function importSetupProfile(
  bundle: MinnowProfileBundle,
  mode: 'create' | 'replace' = 'create',
): Promise<MinnowProfileBundle | Error> {
  try {
    const res = await fetch('/api/profiles/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle, mode }),
    });
    if (!res.ok) return new Error(await parseApiError(res));
    const json = (await res.json()) as { profile?: MinnowProfileBundle };
    return json.profile ?? bundle;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}

/** GET /api/profiles/:id/export — triggers browser download. */
export async function exportSetupProfileFile(id: string): Promise<true | Error> {
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}/export`, {
      cache: 'no-store',
    });
    if (!res.ok) return new Error(await parseApiError(res));
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? `${id}.minnow-profile.json`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}

/** POST /api/profiles/:id/duplicate */
export async function duplicateSetupProfile(
  sourceId: string,
  newId: string,
  newLabel?: string,
): Promise<MinnowProfileBundle | Error> {
  try {
    const res = await fetch(
      `/api/profiles/${encodeURIComponent(sourceId)}/duplicate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newId, newLabel }),
      },
    );
    if (!res.ok) return new Error(await parseApiError(res));
    const json = (await res.json()) as { profile?: MinnowProfileBundle };
    return json.profile ?? ({} as MinnowProfileBundle);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}

/** DELETE /api/profiles/:id */
export async function deleteSetupProfile(id: string): Promise<true | Error> {
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return new Error(await parseApiError(res));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}

/** PUT /api/profiles/workspace-default */
export async function setWorkspaceSetupProfileDefault(
  workspacePath: string,
  profileId: string | null,
): Promise<true | Error> {
  try {
    const res = await fetch('/api/profiles/workspace-default', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath, profileId }),
    });
    if (!res.ok) return new Error(await parseApiError(res));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(message);
  }
}

/** PUT /api/config/meta — workspace auto-apply toggle. */
export async function saveWorkspaceProfileAutoApply(enabled: boolean): Promise<void> {
  const res = await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceProfileAutoApply: enabled }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err && typeof err === 'object' && 'error' in err
        ? String((err as { error: unknown }).error)
        : 'Failed to save workspace profile settings',
    );
  }
}

/** Read active setup profile id from config meta. */
export async function fetchActiveSetupProfileId(): Promise<string | null> {
  try {
    const res = await fetch('/api/config/meta', { cache: 'no-store' });
    if (!res.ok) return null;
    const meta = (await res.json()) as { activeSetupProfileId?: string | null };
    return typeof meta.activeSetupProfileId === 'string'
      ? meta.activeSetupProfileId
      : null;
  } catch {
    return null;
  }
}

/** Invalidate client caches after profile activation. */
export function invalidateCachesAfterProfileActivate(): void {
  resetPromptMetaCache();
  void import('../tools/config.ts').then((m) => {
    m.invalidateToolConfigCache();
  });
  void import('../agents/sub-agent-config.ts').then((m) => {
    if (typeof m.resetSubAgentConfigCache === 'function') {
      m.resetSubAgentConfigCache();
    }
  });
}
