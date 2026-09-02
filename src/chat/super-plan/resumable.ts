import { normalizeModeId } from '../modes/types';
import type { Chat } from '../../types';

/** True when {@link Chat.superPlan} still has a resumable pipeline (not finished/cancelled). */
export function isSuperPlanPipelineResumable(chat: Chat): boolean {
  if (normalizeModeId(chat.modeId) !== 'super-plan') return false;
  const sp = chat.superPlan;
  if (!sp || sp.cancelled) return false;
  if (sp.activeStage === 'present') {
    const record = sp.stages.present;
    if (record?.status === 'done') return false;
  }
  return true;
}

/** Super Plan chats are pipeline transport — not a normal boot landing surface. */
export function isSuperPlanTransportChat(chat: Chat): boolean {
  return normalizeModeId(chat.modeId) === 'super-plan';
}
