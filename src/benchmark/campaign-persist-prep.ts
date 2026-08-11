/**
 * Shrink campaign JSON before POST (64 MB route cap; transcripts trimmed aggressively).
 */

import type { BenchmarkCampaign } from './campaign-types.ts';
import type { TestResult } from './types.ts';
import { truncateTranscriptForPersistence } from './test-result.ts';

/** Per capability-matrix cell transcript budget after fail/partial trim. */
export const CAMPAIGN_CELL_TRANSCRIPT_MAX_BYTES = 32 * 1024;

/** Approximate max serialized campaign size before stripping all transcripts. */
export const CAMPAIGN_PERSIST_SOFT_CAP = 58 * 1024 * 1024;

function isFailOrPartialCell(test: TestResult): boolean {
  if (test.verdict === 'fail' || test.verdict === 'partial') return true;
  if (test.verdict === 'pass' || test.verdict === 'n-a') return false;
  if (test.skipped) return false;
  return !test.passed;
}

/** Keep roughly the last two tool-loop rounds (assistant + tool pairs). */
function trimToLastRounds(messages: import('../types.ts').ApiMessage[]): import('../types.ts').ApiMessage[] {
  if (messages.length <= 6) return messages;
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const tail = rest.slice(-6);
  return [...system, ...tail];
}

function capTranscriptBytes(test: TestResult): void {
  if (!test.transcript?.length) return;
  let messages = truncateTranscriptForPersistence(test.transcript);
  messages = trimToLastRounds(messages);
  let serialized = JSON.stringify(messages);
  while (serialized.length > CAMPAIGN_CELL_TRANSCRIPT_MAX_BYTES && messages.length > 1) {
    const system = messages.filter((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');
    messages = [...system, ...rest.slice(1)];
    serialized = JSON.stringify(messages);
  }
  test.transcript = messages;
  if (serialized.length > CAMPAIGN_CELL_TRANSCRIPT_MAX_BYTES) {
    delete test.transcript;
    test.transcriptMeta = {
      ...test.transcriptMeta,
      error: 'Transcript omitted (cell size cap)',
    };
  }
}

function trimRunTranscripts(run: import('./types.ts').BenchmarkRun): void {
  for (const suite of run.suites) {
    for (const test of suite.tests) {
      if (!isFailOrPartialCell(test)) {
        delete test.transcript;
        continue;
      }
      capTranscriptBytes(test);
    }
  }
}

function stripAllRunTranscripts(run: import('./types.ts').BenchmarkRun): void {
  for (const suite of run.suites) {
    for (const test of suite.tests) {
      if (test.transcript) {
        delete test.transcript;
        test.transcriptMeta = {
          ...test.transcriptMeta,
          error: 'Transcript omitted (campaign size cap)',
        };
      }
    }
  }
}

export interface PrepareCampaignOptions {
  /** Second-pass 413 retry — drop every transcript. */
  stripAllTranscripts?: boolean;
}

/** Prepare campaign payload for persistence (mutates a clone). */
export function prepareCampaignForPersistence(
  campaign: BenchmarkCampaign,
  options?: PrepareCampaignOptions,
): BenchmarkCampaign {
  const clone = structuredClone(campaign) as BenchmarkCampaign;
  if (options?.stripAllTranscripts) {
    for (const run of clone.runs ?? []) {
      stripAllRunTranscripts(run);
    }
    return clone;
  }

  for (const run of clone.runs ?? []) {
    trimRunTranscripts(run);
  }

  for (const cell of clone.cells ?? []) {
    if (!cell.transcript?.length) continue;
    const pseudo: TestResult = {
      testId: cell.testId,
                suite: 'capability-matrix',
      label: cell.label,
      passed: cell.passed,
      skipped: cell.skipped,
      durationMs: cell.durationMs,
      score: cell.score,
      transcript: cell.transcript,
      transcriptMeta: cell.transcriptMeta,
    };
    if (!isFailOrPartialCell(pseudo)) {
      delete cell.transcript;
      continue;
    }
    capTranscriptBytes(pseudo);
    cell.transcript = pseudo.transcript;
    cell.transcriptMeta = pseudo.transcriptMeta;
  }

  let serialized = JSON.stringify(clone);
  if (serialized.length <= CAMPAIGN_PERSIST_SOFT_CAP) return clone;

  for (const run of clone.runs ?? []) {
    stripAllRunTranscripts(run);
  }
  for (const cell of clone.cells ?? []) {
    delete cell.transcript;
  }
  return clone;
}
