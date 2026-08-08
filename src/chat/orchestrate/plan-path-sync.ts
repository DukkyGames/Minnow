/**
 * Persist chat ↔ group orchestrate plan paths after resolving the effective path.
 */

import { scheduleSaveSessions, touchChat } from '../../state/sessions';
import type { Chat, ChatGroup } from '../../types';
import {
  normalizeOrchestratePlanPath,
  resolveEffectiveOrchestratePlanPath,
} from './plan-path';

export interface SyncEffectiveOrchestratePlanPathOptions {
  /** When true, copy the resolved path onto chat and group when only one side is set. */
  sync?: boolean;
}

/**
 * Resolve the effective plan path and optionally align chat and group persistence.
 */
export function resolveEffectiveOrchestratePlanPathWithSync(
  chat: Chat,
  group?: ChatGroup | null,
  options?: SyncEffectiveOrchestratePlanPathOptions,
): string | undefined {
  const fromChat = normalizeOrchestratePlanPath(chat.orchestratePlanPath ?? '');
  const fromGroup = group
    ? normalizeOrchestratePlanPath(group.orchestratePlanPath ?? '')
    : undefined;
  const effective = resolveEffectiveOrchestratePlanPath(chat, group);
  if (!effective) return undefined;

  if (options?.sync && group) {
    let dirty = false;
    if (!fromChat) {
      chat.orchestratePlanPath = effective;
      touchChat(chat);
      dirty = true;
    }
    if (!fromGroup) {
      group.orchestratePlanPath = effective;
      dirty = true;
    }
    if (dirty) scheduleSaveSessions();
  }

  return effective;
}
