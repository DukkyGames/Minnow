/**
 * Client API for mode/expert/sub-agent prompt bodies (built-in + ~/.minnow overrides).
 */

export type PromptFileFamily = 'modes' | 'experts' | 'sub-agents';
export type PromptFileProfile = 'full' | 'lite';

export interface PromptFileResponse {
  content: string;
  source: 'builtin' | 'override';
}

export async function fetchPromptFile(
  family: PromptFileFamily,
  entityId: string,
  profile: PromptFileProfile = 'full',
): Promise<PromptFileResponse | null> {
  try {
    const res = await fetch(
      `/api/prompts/${family}/${encodeURIComponent(entityId)}/prompt?profile=${profile}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as PromptFileResponse;
  } catch {
    return null;
  }
}

/** Shipped repo prompt only (ignores ~/.minnow file overrides). */
export async function fetchPromptBuiltinBaseline(
  family: PromptFileFamily,
  entityId: string,
  profile: PromptFileProfile = 'full',
): Promise<PromptFileResponse | null> {
  try {
    const res = await fetch(
      `/api/prompts/${family}/${encodeURIComponent(entityId)}/prompt?profile=${profile}&baseline=builtin`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as PromptFileResponse;
  } catch {
    return null;
  }
}

export async function savePromptFileOverride(
  family: PromptFileFamily,
  entityId: string,
  profile: PromptFileProfile,
  content: string,
): Promise<PromptFileResponse | null> {
  try {
    const res = await fetch(
      `/api/prompts/${family}/${encodeURIComponent(entityId)}/prompt?profile=${profile}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, content }),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as PromptFileResponse;
  } catch {
    return null;
  }
}

export async function resetPromptFileOverride(
  family: PromptFileFamily,
  entityId: string,
  profile: PromptFileProfile,
): Promise<PromptFileResponse | null> {
  try {
    const res = await fetch(
      `/api/prompts/${family}/${encodeURIComponent(entityId)}/prompt?profile=${profile}`,
      { method: 'DELETE' },
    );
    if (!res.ok) return null;
    return (await res.json()) as PromptFileResponse;
  } catch {
    return null;
  }
}
