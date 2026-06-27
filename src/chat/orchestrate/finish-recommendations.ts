/**
 * LLM-generated follow-up recommendations for the Orchestrate finish dashboard (MIN-208).
 */

import {
  cancelGeneration,
  createGeneration,
  subscribeToGeneration,
  type GenerationEndEvent,
} from '../../api/generations.ts';
import { StreamingContentAccumulator } from '../../api/message-content.ts';
import { modelCache } from '../../app-state.ts';
import { thinkingToCompletionBody } from '../../agents/thinking-to-body.ts';
import { getAutopilotMetaSync } from '../../config/autopilot-meta.ts';
import { decodeModelSelectKey, encodeModelSelectKey } from '../../lib/model-select-key.ts';
import { catalogCapabilitiesFromRow } from '../../providers/model-capabilities.ts';
import { resolveProvider } from '../../providers/store.ts';
import { emitBoardChange } from '../../state/orchestrate-board-events.ts';
import {
  scheduleSaveSessions,
  touchChat,
} from '../../state/sessions.ts';
import { executeTool } from '../../tools/client.ts';
import type { ApiMessage, Chat, ChatCompletionChunk, OrchestrateBoardState } from '../../types.ts';
import {
  FINISH_REPORT_RECOMMENDATIONS_PLACEHOLDER,
  mergeFinishReportRecommendations,
} from './finish-stats.ts';

const RECOMMENDATIONS_SYSTEM =
  'You recommend concrete follow-up engineering tasks after an Orchestrate board run completes. ' +
  'Output ONLY a markdown bullet list (- item). Each item must be actionable and specific. ' +
  'Do not repeat tasks already completed on the board. Base recommendations on the plan goals, ' +
  'scope, checklists, cleanup notes, and any implied future work. No preamble, headings, or numbering.';

const MAX_PLAN_CHARS = 16_000;
const MAX_RECOMMENDATION_TOKENS = 512;

/** In-flight enrichment per board group — avoids duplicate generation calls. */
const enrichInFlight = new Map<string, Promise<void>>();

/** Provider/model for finish recommendations — same binding as board task chats. */
function resolvePlannerModelBinding(plannerChat: Chat): {
  providerId: string;
  modelId: string;
} {
  let providerId = plannerChat.providerId?.trim() ?? '';
  let modelId = plannerChat.modelId?.trim() ?? '';
  if (!modelId) {
    const domRaw =
      (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value?.trim() ??
      '';
    if (domRaw) {
      const parsed = decodeModelSelectKey(domRaw);
      if (parsed) {
        providerId = providerId || parsed.providerId;
        modelId = parsed.modelId;
      } else {
        modelId = domRaw;
      }
    }
  }
  if (!modelId) {
    const meta = getAutopilotMetaSync();
    providerId = providerId || meta.plannerProviderId?.trim() || '';
    modelId = meta.plannerModelId?.trim() || '';
  }
  return { providerId, modelId };
}

function truncatePlanText(text: string, maxChars = MAX_PLAN_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n\n... (plan truncated)`;
}

/** Build a compact board summary for the recommendations prompt. */
function buildBoardSummary(board: OrchestrateBoardState): string {
  const completed = board.tasks
    .filter((t) => t.status === 'complete')
    .map((t) => `- ${t.id}: ${t.title}`)
    .join('\n');
  const quarantined = board.tasks
    .filter((t) => t.status === 'quarantined')
    .map((t) => `- ${t.id}: ${t.title}`)
    .join('\n');
  const lines = [
    `Integration branch: ${board.integrationBranch?.trim() || '(not set)'}`,
    '',
    'Completed board tasks (do not repeat these):',
    completed || '(none)',
  ];
  if (quarantined) {
    lines.push('', 'Quarantined tasks:', quarantined);
  }
  const issues = board.unresolvedIssues;
  if (issues && issues.length > 0) {
    lines.push('', 'Unresolved issues:');
    for (const issue of issues) {
      lines.push(`- ${issue.title}: ${issue.summary}`);
    }
  }
  return lines.join('\n');
}

/** Build system + user messages for plan-based follow-up recommendations. */
export function buildFinishRecommendationsPrompt(
  planContent: string,
  board: OrchestrateBoardState,
): ApiMessage[] {
  const userBody = [
    'The Orchestrate board finished. Suggest 3–7 follow-up tasks the team should tackle next.',
    '',
    '## Board summary',
    buildBoardSummary(board),
    '',
    '## Plan',
    truncatePlanText(planContent),
    '',
    'Write the markdown bullet list of recommended next tasks.',
  ].join('\n');

  return [
    { role: 'system', content: RECOMMENDATIONS_SYSTEM },
    { role: 'user', content: userBody },
  ];
}

/** Normalize model output into a markdown bullet list. */
export function sanitizeRecommendationsMarkdown(raw: string): string {
  let text = raw.trim();
  const fenceMatch = text.match(/^```(?:\w+)?\s*([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  text = text.replace(/^#+\s*recommended[^\n]*\n+/i, '');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^[-*•]\s/.test(line)) return line.replace(/^[*•]\s/, '- ');
      if (/^\d+[.)]\s/.test(line)) return `- ${line.replace(/^\d+[.)]\s*/, '')}`;
      return `- ${line}`;
    });
  return lines.join('\n');
}

async function loadPlanContent(planPath: string): Promise<string | null> {
  const trimmed = planPath.trim();
  if (!trimmed) return null;
  try {
    const result = await executeTool('read_file', { path: trimmed });
    const content = result.content?.trim();
    return content || null;
  } catch {
    return null;
  }
}

async function fetchRecommendationsFromLlm(
  plannerChat: Chat,
  board: OrchestrateBoardState,
  planContent: string,
): Promise<string | null> {
  const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
  if (!providerId || !modelId) return null;

  const provider = await resolveProvider(providerId);
  const messages = buildFinishRecommendationsPrompt(planContent, board);
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    temperature: 0.4,
    max_tokens: MAX_RECOMMENDATION_TOKENS,
    stream: true,
  };

  const modelRow = modelCache.get(encodeModelSelectKey(provider.id, modelId));
  const modelCaps =
    modelRow?.capabilities ??
    (modelRow ? catalogCapabilitiesFromRow(modelRow) : undefined);
  const { body: thinkingPatch } = thinkingToCompletionBody(
    'off',
    provider.apiKind,
    modelCaps,
  );
  Object.assign(body, thinkingPatch);

  let generationId: string;
  try {
    ({ generationId } = await createGeneration(provider.id, body, { persist: false }));
  } catch {
    return null;
  }

  const contentAcc = new StreamingContentAccumulator();

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (text: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(text);
    };

    const unsubscribe = subscribeToGeneration(generationId, {
      onChunk: (chunk: ChatCompletionChunk) => {
        contentAcc.ingestChoice(chunk.choices?.[0]);
      },
      onEnd: (event?: GenerationEndEvent) => {
        unsubscribe();
        if (event?.status === 'error') {
          finish(null);
          return;
        }
        const cleaned = sanitizeRecommendationsMarkdown(contentAcc.getText().trim());
        finish(cleaned.length > 0 ? cleaned : null);
      },
      onTransportError: () => {
        unsubscribe();
        void cancelGeneration(generationId).catch(() => {
          /* best-effort */
        });
        finish(null);
      },
    });
  });
}

function recommendationsFallback(noModel: boolean, noPlan: boolean): string {
  if (noModel) {
    return '_Select a model on the orchestrate planner to generate recommendations._';
  }
  if (noPlan) {
    return '_No plan file on this board — add a plan path to get tailored recommendations._';
  }
  return '_Could not generate recommendations. Try **Start follow-up chat** for manual suggestions._';
}

/**
 * Replace the recommendations placeholder in {@link OrchestrateBoardState.finishReport}
 * with LLM output derived from the plan. No-op when already enriched or in flight.
 */
export async function enrichFinishReportWithRecommendations(
  groupId: string,
  plannerChat: Chat,
  board: OrchestrateBoardState,
): Promise<void> {
  const report = board.finishReport?.trim();
  if (!report || !report.includes(FINISH_REPORT_RECOMMENDATIONS_PLACEHOLDER)) {
    return;
  }

  const existing = enrichInFlight.get(groupId);
  if (existing) {
    await existing;
    return;
  }

  const work = (async (): Promise<void> => {
    const planPath =
      plannerChat.orchestratePlanPath?.trim() || board.planPath?.trim() || '';
    const { providerId, modelId } = resolvePlannerModelBinding(plannerChat);
    const noModel = !providerId || !modelId;

    let recommendations: string | null = null;
    if (!noModel) {
      const planContent = await loadPlanContent(planPath);
      if (planContent) {
        recommendations = await fetchRecommendationsFromLlm(plannerChat, board, planContent);
      } else {
        board.finishReport = mergeFinishReportRecommendations(
          board.finishReport ?? report,
          recommendationsFallback(false, !planPath.trim()),
        );
        touchChat(plannerChat);
        scheduleSaveSessions();
        emitBoardChange(groupId);
        return;
      }
    }

    const fallback = recommendationsFallback(noModel, false);
    board.finishReport = mergeFinishReportRecommendations(
      board.finishReport ?? report,
      recommendations ?? fallback,
    );
    touchChat(plannerChat);
    scheduleSaveSessions();
    emitBoardChange(groupId);
  })();

  enrichInFlight.set(groupId, work);
  try {
    await work;
  } finally {
    enrichInFlight.delete(groupId);
  }
}

/** Clear in-flight state (test teardown). */
export function clearFinishRecommendationsStateForTests(): void {
  enrichInFlight.clear();
}
