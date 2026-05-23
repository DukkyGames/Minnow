/**
 * Optional LLM judgement when heuristic recovery is ambiguous (R10).
 */

import { pathsForProvider } from '../../providers/paths.ts';
import { getActiveProvider } from '../../providers/store.ts';
import { isOrchestratePlanComplete } from '../../chat/orchestrate/plan-complete.ts';
import type { Chat, OrchestrateBoardState } from '../../types.ts';
import { getSupervisorConfigSnapshot } from './config.ts';
import type { SupervisorDecision } from './rules.ts';
import type { SupervisorChatState } from './state.ts';

const fingerprintAt = new Map<string, number>();
const FINGERPRINT_TTL_MS = 60_000;

function stableBundleFingerprint(
  chat: Chat,
  board: OrchestrateBoardState,
  sup: SupervisorChatState,
): string {
  const tail = (sup.lastReport?.phase ?? '') + (sup.lastReport?.nextAction ?? '');
  return `${chat.id}:${board.lastUpdatedAt}:${tail.length}`;
}

function mapLlmAction(raw: string): SupervisorDecision {
  const action = raw.trim().toLowerCase();
  if (action === 'resume' || action === 'inject_resume') {
    return { action: 'inject_resume', rule: 'R10', payload: { source: 'llm' } };
  }
  if (action === 'restart_run' || action === 'restart') {
    return { action: 'restart_run', rule: 'R10', payload: { source: 'llm' } };
  }
  if (action === 'escalate_user' || action === 'ask') {
    return { action: 'escalate_user', rule: 'R10', payload: { source: 'llm' } };
  }
  return { action: 'none' };
}

/**
 * Calls the configured provider once; returns a mapped decision or null on failure.
 */
export async function runLlmEscalationJudgement(
  chat: Chat,
  board: OrchestrateBoardState,
  sup: SupervisorChatState,
): Promise<SupervisorDecision | null> {
  if (isOrchestratePlanComplete(board) || sup.planCompletedAt != null) {
    return { action: 'none' };
  }
  const cfg = getSupervisorConfigSnapshot();
  const fp = stableBundleFingerprint(chat, board, sup);
  const last = fingerprintAt.get(fp) ?? 0;
  const now = Date.now();
  if (now - last < FINGERPRINT_TTL_MS) {
    return null;
  }
  fingerprintAt.set(fp, now);

  const provider = await getActiveProvider(
    cfg.escalationProviderId.trim() || chat.providerId,
  );
  const paths = pathsForProvider(provider);
  const modelId =
    cfg.escalationModelId.trim() || chat.modelId.trim() || 'local-model';

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), cfg.llmEscalationTimeoutMs);

  try {
    const url = `${provider.baseUrl.replace(/\/$/, '')}${paths.chatCompletionsPath}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const system = [
      'You are the Orchestrate supervisor. Reply JSON only:',
      '{"action":"resume"|"restart_run"|"escalate_user"|"noop","reason":"short string","taskId":"optional","runId":"optional"}',
      `Board summary: ${board.tasks.length} tasks; last report phase: ${sup.lastReport?.phase ?? 'none'}.`,
    ].join('\n');

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Pick the safest next recovery step.' },
        ],
        temperature: 0,
        max_tokens: 128,
        stream: false,
      }),
    });

    if (!res.ok) return { action: 'escalate_user', rule: 'R10', payload: { source: 'llm_http' } };

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content?.trim() ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { action: 'escalate_user', rule: 'R10', payload: { source: 'llm_parse' } };

    const parsed = JSON.parse(jsonMatch[0]) as {
      action?: string;
      taskId?: string;
      runId?: string;
    };
    const mapped = mapLlmAction(parsed.action ?? 'noop');
    if (parsed.runId && mapped.action === 'restart_run') {
      mapped.payload = { ...mapped.payload, runId: parsed.runId };
    }
    return mapped;
  } catch {
    return { action: 'escalate_user', rule: 'R10', payload: { source: 'llm_timeout' } };
  } finally {
    clearTimeout(timer);
  }
}
