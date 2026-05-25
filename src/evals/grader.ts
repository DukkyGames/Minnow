/**
 * LLM-as-judge rubric grading for eval cells.
 */

import { pathsForProvider } from '../providers/paths';
import { getActiveProvider } from '../providers/store';
import { extractMessageText } from '../api/chat';
import type { EvalConfig } from './types';
import { parseGraderJson } from './grader-parse';
import type { EvalGraderResult } from './types';

export interface GradeEvalInput {
  rubricPrompt: string;
  candidateSummary: string;
  transcriptExcerpt?: string;
  config: EvalConfig;
  /** Fallback when grader ids unset. */
  fallbackProviderId: string;
  fallbackModelId: string;
  signal?: AbortSignal;
}

export interface EvalGrader {
  grade(input: GradeEvalInput): Promise<EvalGraderResult>;
}

/** Default grader: single non-streaming completion with JSON rubric. */
export const defaultEvalGrader: EvalGrader = {
  async grade(input): Promise<EvalGraderResult> {
    const providerId =
      input.config.graderProviderId.trim() || input.fallbackProviderId;
    const modelId =
      input.config.graderModelId.trim() || input.fallbackModelId;
    const provider = await getActiveProvider(providerId);
    const paths = pathsForProvider(provider);
    const url = `${provider.baseUrl.replace(/\/$/, '')}${paths.chatCompletionsPath}`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const system = [
      'You are an eval grader. Follow the rubric exactly.',
      'Reply with JSON only: {"score":number,"pass":boolean,"rationale":string,"tags"?:string[]}',
    ].join('\n');

    const userParts = [
      `Rubric:\n${input.rubricPrompt}`,
      `\nCandidate answer:\n${input.candidateSummary}`,
    ];
    if (input.transcriptExcerpt?.trim()) {
      userParts.push(`\nTranscript excerpt:\n${input.transcriptExcerpt.slice(0, 4000)}`);
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      input.config.graderTimeoutMs,
    );
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId || undefined,
          temperature: 0.1,
          max_tokens: 512,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userParts.join('') },
          ],
        }),
        signal,
      });
      if (!res.ok) {
        const errText = await res.text();
        return {
          score: 0,
          pass: false,
          rationale: `Grader HTTP ${res.status}: ${errText.slice(0, 200)}`,
        };
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = extractMessageText(json.choices?.[0]?.message ?? {}).trim();
      return parseGraderJson(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        score: 0,
        pass: false,
        rationale: `Grader failed: ${message}`,
      };
    } finally {
      window.clearTimeout(timeout);
    }
  },
};

let graderFactory: () => EvalGrader = () => defaultEvalGrader;

export function setEvalGraderFactory(factory: () => EvalGrader): void {
  graderFactory = factory;
}

export function resetEvalGraderFactory(): void {
  graderFactory = () => defaultEvalGrader;
}

export function getEvalGrader(): EvalGrader {
  return graderFactory();
}
