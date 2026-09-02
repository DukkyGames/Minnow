import type { Chat } from '../../types';
import { getEnabledToolDefinitionsForMode, getEnabledToolDefinitionsForChat } from '../../tools/client';
import { resolveExpertToolNames } from './runtime-profile';

type ModeToolDefs = ReturnType<typeof getEnabledToolDefinitionsForMode>;

/** Filter mode tool defs by expert snapshot allow/deny policy. */
export function filterToolsByExpertSnapshot(
  chat: Chat,
  modeDefs: ModeToolDefs,
): ModeToolDefs {
  const snapshot = chat.expertRuntime;
  if (chat.kind !== 'expert' || !snapshot) return modeDefs;

  const modeNames = modeDefs.map((d) => d.function.name);
  const { enabledToolNames } = resolveExpertToolNames(modeNames, {
    toolAllowlist: snapshot.toolAllowlist ?? undefined,
    toolDenylist: snapshot.toolDenylist,
  });
  const allowed = new Set(enabledToolNames);
  return modeDefs.filter((d) => allowed.has(d.function.name));
}

/** Ordered tool names for compose context / token estimate parity with send path. */
export function getExpertAwareToolNamesForChat(chat: Chat): string[] {
  return getEnabledToolDefinitionsForChat(chat).map((d) => d.function.name);
}
