/**
 * Plain-text formatter for benchmark probe transcripts (clipboard / bug reports).
 */

import { apiMessageContentToText } from '../api/message-content.ts';
import type { BenchmarkRun, TestResult } from '../benchmark/types.ts';
import type { ApiMessage, ApiMessageContent } from '../types.ts';
import { SUITE_LABELS } from './benchmark-transcript-labels.ts';

export type BenchmarkTranscriptRunMeta = {
  preset: BenchmarkRun['preset'];
  modelId: string;
  startedAt: string;
};

export type FormatBenchmarkTranscriptOptions = {
  suiteLabel?: string;
};

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function statusLabel(result: TestResult): string {
  if (result.verdict === 'untested') return 'Untested';
  if (result.skipped) return 'Skipped';
  if (result.verdict === 'partial') return 'Partial';
  if (result.passed) return 'Pass';
  return 'Fail';
}

function formatUserContent(content: ApiMessageContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return apiMessageContentToText(content);

  const lines: string[] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      lines.push(part.text);
      continue;
    }
    if (part.type === 'image_url' && part.image_url?.url) {
      const url = part.image_url.url;
      const preview =
        url.startsWith('data:') ? `[image: data URL, ${url.length} chars]` : `[image: ${url}]`;
      lines.push(preview);
    }
  }
  return lines.join('\n').trim() || apiMessageContentToText(content);
}

function formatAssistantContent(msg: ApiMessage): string {
  const chunks: string[] = [];
  const prose = apiMessageContentToText(msg.content).trim();
  if (prose) chunks.push(prose);

  const reasoning =
    typeof msg.reasoning === 'string' && msg.reasoning.trim() ?
      msg.reasoning.trim()
    : typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim() ?
      msg.reasoning_content.trim()
    : '';
  if (reasoning) {
    chunks.push(`[reasoning]\n${reasoning}`);
  }

  return chunks.join('\n\n').trim();
}

function prettyJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '{}';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function formatToolCalls(msg: ApiMessage): string[] {
  if (!msg.tool_calls?.length) return [];
  const lines: string[] = ['[assistant — tool_calls]'];
  for (const call of msg.tool_calls) {
    lines.push(`• ${call.function.name} (id=${call.id})`);
    lines.push(`  arguments:\n${prettyJson(call.function.arguments)}`);
  }
  return lines;
}

function formatMessageBlock(msg: ApiMessage, index: number): string {
  const header = `[${index + 1}] ${msg.role}`;
  if (msg.role === 'system') {
    return `${header}\n${msg.content}`;
  }
  if (msg.role === 'user') {
    return `${header}\n${formatUserContent(msg.content)}`;
  }
  if (msg.role === 'assistant') {
    const parts = [header];
    const prose = formatAssistantContent(msg);
    if (prose) parts.push(prose);
    parts.push(...formatToolCalls(msg));
    if (parts.length === 1) parts.push('(empty assistant message)');
    return parts.join('\n\n');
  }
  if (msg.role === 'tool') {
    const id = msg.tool_call_id ? ` (tool_call_id=${msg.tool_call_id})` : '';
    return `${header}${id}\n${msg.content}`;
  }
  return `${header}\n${JSON.stringify(msg)}`;
}

/**
 * Build a diagnostic plain-text dump for one benchmark test result.
 */
export function formatBenchmarkTranscriptForCopy(
  test: TestResult,
  runMeta: BenchmarkTranscriptRunMeta,
  options?: FormatBenchmarkTranscriptOptions,
): string {
  const lines: string[] = ['=== Benchmark probe transcript ===', ''];

  lines.push(`Test: ${test.label}`);
  lines.push(`Test ID: ${test.testId}`);
  lines.push(
    `Suite: ${options?.suiteLabel ?? SUITE_LABELS[test.suite] ?? test.suite} (${test.suite})`,
  );
  lines.push(`Verdict: ${statusLabel(test)}`);
  lines.push(`Passed: ${test.passed ? 'yes' : 'no'}`);
  lines.push(`Skipped: ${test.skipped ? 'yes' : 'no'}`);
  if (test.skipReason?.trim()) lines.push(`Skip reason: ${test.skipReason.trim()}`);
  if (test.judged != null) lines.push(`Judged: ${test.judged ? 'yes' : 'no'}`);
  lines.push(`Score: ${test.score}`);
  lines.push(`Duration: ${formatDurationMs(test.durationMs)}`);
  if (test.ttftMs != null) lines.push(`TTFT: ${Math.round(test.ttftMs)} ms`);
  if (test.tokPerSec != null) lines.push(`Throughput: ${Math.round(test.tokPerSec)} tok/s`);

  lines.push('');
  lines.push(`Run preset: ${runMeta.preset}`);
  lines.push(`Model: ${runMeta.modelId}`);
  lines.push(`Started: ${runMeta.startedAt}`);

  if (test.details?.trim()) {
    lines.push('');
    lines.push('Details:');
    lines.push(test.details.trim());
  }

  if (test.transcriptMeta?.finishReason) {
    lines.push('');
    lines.push(`Finish reason: ${test.transcriptMeta.finishReason}`);
  }
  if (test.transcriptMeta?.error?.trim()) {
    lines.push('');
    lines.push('Probe error:');
    lines.push(test.transcriptMeta.error.trim());
  }

  const messages = test.transcript ?? [];
  lines.push('');
  lines.push(`--- Messages (${messages.length}) ---`);
  lines.push('');

  if (!messages.length) {
    lines.push('(none)');
  } else {
    for (let i = 0; i < messages.length; i += 1) {
      lines.push(formatMessageBlock(messages[i]!, i));
      if (i < messages.length - 1) lines.push('');
    }
  }

  if (test.transcriptMeta?.judgeRaw?.trim()) {
    lines.push('');
    lines.push('--- Judge output ---');
    lines.push('');
    lines.push(test.transcriptMeta.judgeRaw.trim());
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
