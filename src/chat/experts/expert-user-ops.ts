/**
 * Save and delete user-owned experts (Experts hub CRUD).
 */

import {
  deleteExpertEntity,
  fetchPromptFileRaw,
  resetPromptFileOverride,
  savePromptFileOverride,
} from '../prompts/prompt-file-api';
import { buildExpertMarkdown, parseExpertFiles } from './expert-markdown';
import { isUserOwnedExpert } from './expert-ownership';
import {
  getBuiltinExpertIds,
  getExpert,
  syncExpertRegistryFromServer,
} from './registry';
import type { ExpertAccent, ExpertMeta } from './types';

export interface SaveUserExpertInput {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  accent?: ExpertAccent;
  tagline?: string;
  greeting?: string;
  fullBody: string;
  liteBody: string;
  liteEdited: boolean;
}

/** Persist edited meta and bodies for a user-owned expert. */
export async function saveUserExpert(input: SaveUserExpertInput): Promise<void> {
  const record = getExpert(input.id);
  if (!isUserOwnedExpert(record, getBuiltinExpertIds())) {
    throw new Error('This expert cannot be edited here.');
  }

  const meta: ExpertMeta = {
    id: input.id,
    label: input.label.trim() || input.id,
    kind: 'expert',
    description: input.description?.trim() || undefined,
    tagline: input.tagline?.trim() || undefined,
    greeting: input.greeting?.trim() || undefined,
    icon: input.icon?.trim() || undefined,
    accent: input.accent,
  };

  const markdownMeta = {
    id: meta.id,
    label: meta.label,
    description: meta.description,
    tagline: meta.tagline,
    greeting: meta.greeting,
    icon: meta.icon,
    accent: meta.accent,
  };

  const liteBody =
    input.liteEdited
      ? input.liteBody.trim()
      : input.liteBody.trim() || record?.liteBody?.trim() || input.fullBody.slice(0, 500);

  const fullMarkdown = buildExpertMarkdown(markdownMeta, input.fullBody, 'full');
  const liteMarkdown = buildExpertMarkdown(markdownMeta, liteBody, 'lite');

  const fullSaved = await savePromptFileOverride('experts', input.id, 'full', fullMarkdown);
  const liteSaved = await savePromptFileOverride('experts', input.id, 'lite', liteMarkdown);
  if (!fullSaved || !liteSaved) {
    throw new Error('Could not save expert. Open or restart Minnow.');
  }

  await syncExpertRegistryFromServer();
}

/** Remove a user-owned expert directory from ~/.minnow. */
export async function deleteUserExpert(id: string): Promise<void> {
  const record = getExpert(id);
  if (!isUserOwnedExpert(record, getBuiltinExpertIds())) {
    throw new Error('This expert cannot be deleted.');
  }

  await resetPromptFileOverride('experts', id, 'full');
  await resetPromptFileOverride('experts', id, 'lite');
  const removed = await deleteExpertEntity(id);
  if (!removed) {
    throw new Error('Could not delete expert files.');
  }

  await syncExpertRegistryFromServer();
}

/** Load edit form fields for a user-owned expert. */
export async function loadUserExpertForEdit(id: string): Promise<{
  meta: ExpertMeta;
  fullBody: string;
  liteBody: string;
} | null> {
  const record = getExpert(id);
  if (!isUserOwnedExpert(record, getBuiltinExpertIds())) return null;

  const fullRaw = await fetchPromptFileRaw('experts', id, 'full');
  const liteRaw = await fetchPromptFileRaw('experts', id, 'lite');
  if (!fullRaw?.content) return null;

  const parsed = parseExpertFiles(
    fullRaw.content,
    liteRaw?.content ?? buildExpertMarkdown(record!.meta, record!.fullBody, 'lite'),
  );
  if (!parsed) return null;

  return {
    meta: parsed.meta,
    fullBody: parsed.fullBody,
    liteBody: parsed.liteBody || record!.fullBody.slice(0, 500),
  };
}
