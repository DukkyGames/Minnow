/**
 * Resolve system + user rules for headless without SPA compose UI deps.
 */

import { getSystemPrompt } from '../config/api-client';
import { getUserRulesPayloadForSend, loadUserRules } from '../config/user-rules';
import { defaultUserRulesSettings } from '../config/defaults';
import { resolveActiveWorkAgentId } from '../agents/resolve-work-agent';
import type { Chat } from '../types';
import { headlessApiUrl } from './server-context';

export interface HeadlessOutboundSystemMessages {
  composed: string;
  userRules: string | null;
}

async function fetchWorkAgentPromptBody(
  agentId: string,
  profile: string,
): Promise<string> {
  const prof = profile === 'lite' ? 'lite' : 'full';
  const res = await fetch(
    headlessApiUrl(
      `/api/work-agents/${encodeURIComponent(agentId)}/prompt?profile=${prof}`,
    ),
    { cache: 'no-store' },
  );
  if (!res.ok) return '';
  const body = (await res.json()) as { content?: string; markdownBody?: string };
  const text =
    typeof body.content === 'string'
      ? body.content
      : typeof body.markdownBody === 'string'
        ? body.markdownBody
        : '';
  return text.trim();
}

/** Headless outbound system messages (legacy textarea + work-agent prompt + rules). */
export async function resolveHeadlessOutboundSystemMessages(
  chat: Chat,
  profile: string,
): Promise<HeadlessOutboundSystemMessages> {
  const legacy = await getSystemPrompt().catch(() => ({ text: '' }));
  const legacySysPrompt = typeof legacy.text === 'string' ? legacy.text.trim() : '';

  let composed = legacySysPrompt;
  const agentId = resolveActiveWorkAgentId(chat);
  if (agentId) {
    const agentPrompt = await fetchWorkAgentPromptBody(agentId, profile);
    if (agentPrompt) {
      composed = agentPrompt;
    }
  }

  await loadUserRules().catch(() => undefined);
  const rulesSettings = await loadUserRules().catch(() => defaultUserRulesSettings());
  const userRules = getUserRulesPayloadForSend(rulesSettings);

  return { composed: composed.trim() || legacySysPrompt, userRules };
}
