/**
 * Resolve shipped built-in baselines for custom prompt-config part editors.
 */

import { getActiveChat, getExpertSelection } from '../../state/sessions';
import { normalizeModeId } from '../modes/types';
import { loadPromptMetaSettings } from '../../config/prompt-meta';
import { loadBuiltinPromptById } from './prompt-loader';
import type { PromptKind, PromptPartId, PromptProfile } from './types';

const PARTS_WITHOUT_DIFF = new Set<PromptPartId>(['memory', 'skill']);

/** Parts that cannot be diffed in Settings (resolved at send from session). */
export function isPromptPartDiffSupported(partId: PromptPartId): boolean {
  return !PARTS_WITHOUT_DIFF.has(partId);
}

function kindForPart(partId: PromptPartId): PromptKind {
  if (partId === 'tool-usage') return 'tool-usage';
  if (partId === 'work-agent') return 'work-agent';
  if (partId === 'mode') return 'mode';
  if (partId === 'expert') return 'expert';
  if (partId === 'info') return 'info';
  return 'base';
}

function defaultIdForPart(partId: PromptPartId): string {
  if (partId === 'base' || partId === 'tool-usage') return 'default';
  if (partId === 'mode') return 'build';
  if (partId === 'expert') return 'general';
  if (partId === 'info') return 'general-assistant';
  if (partId === 'work-agent') return 'default';
  return 'default';
}

async function resolvePartEntityId(partId: PromptPartId): Promise<string> {
  const chat = getActiveChat();
  if (partId === 'mode') return normalizeModeId(chat.modeId);
  if (partId === 'expert') {
    const selection = getExpertSelection(chat);
    return selection.expertId?.trim() || chat.lastResolvedExpertId?.trim() || defaultIdForPart(partId);
  }
  if (partId === 'work-agent') return chat.workAgentId?.trim() || defaultIdForPart(partId);
  if (partId === 'info') {
    const meta = await loadPromptMetaSettings();
    return meta.activeInfoPresetId?.trim() || defaultIdForPart(partId);
  }
  return defaultIdForPart(partId);
}

/**
 * Profile used for baseline: active full/lite meta, else full when global is custom.
 */
export async function resolveBaselineProfileForCustomParts(): Promise<'full' | 'lite'> {
  const meta = await loadPromptMetaSettings();
  if (meta.activePromptProfile === 'lite') return 'lite';
  return 'full';
}

/**
 * Shipped built-in body for a custom profile part (builtin registry only).
 */
export async function resolveBuiltinPromptBaselineForPart(
  partId: PromptPartId,
): Promise<string> {
  if (!isPromptPartDiffSupported(partId)) return '';
  const profile = await resolveBaselineProfileForCustomParts();
  const loadProfile: PromptProfile = profile;
  const kind = kindForPart(partId);
  const id = await resolvePartEntityId(partId);
  const loaded = loadBuiltinPromptById(kind, id, loadProfile);
  return loaded?.body?.trim() ?? '';
}

/** Hint shown when comparing custom parts while global profile is custom. */
export async function customPartBaselineProfileHint(): Promise<string> {
  const profile = await resolveBaselineProfileForCustomParts();
  return profile === 'lite'
    ? 'Compared against shipped lite default'
    : 'Compared against shipped full default';
}
