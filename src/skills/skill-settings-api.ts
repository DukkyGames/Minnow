/**
 * Settings APIs for creating and editing user skills (npm start required).
 */

import type { SkillDetail } from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface CreateSkillResponse {
  ok: boolean;
  skill?: SkillDetail;
  error?: string;
}

interface SaveSkillResponse {
  ok: boolean;
  skill?: SkillDetail;
  error?: string;
}

/** Create a custom skill from the built-in template under ~/.minnow/skills/. */
export async function createCustomSkill(
  id: string,
  label?: string,
): Promise<SkillDetail | null> {
  const res = await fetch('/api/skills', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, label }),
  });

  const data = (await res.json().catch(() => ({}))) as CreateSkillResponse;
  if (!res.ok) {
    throw new Error(data.error ?? `Create skill failed (${res.status})`);
  }

  return data.skill ?? null;
}

/** Save SKILL.md content for a user skill (built-in overrides write to user path). */
export async function saveSkillContent(
  id: string,
  content: string,
): Promise<SkillDetail | null> {
  const res = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content }),
  });

  const data = (await res.json().catch(() => ({}))) as SaveSkillResponse;
  if (!res.ok) {
    throw new Error(data.error ?? `Save skill failed (${res.status})`);
  }

  return data.skill ?? null;
}
