/**
 * MCQ letter-match harness (MMLU, ARC, TruthfulQA full).
 */

import type { StandardBenchmarkItem } from '../types.ts';
import type { StandardScoreResult } from './types.ts';

/** Extract the model's chosen MCQ letter from prose or truncated reasoning. */
function normalizeLetter(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  // Direct letter-only answers (e.g. "B" or "B.")
  if (/^[A-D][\s.!?:;]*$/i.test(trimmed)) {
    return trimmed[0]!.toUpperCase();
  }

  // Final line is often the letter when the model follows "answer with the letter only"
  const lastLine = trimmed.split(/\n+/).pop()?.trim() ?? '';
  if (/^[A-D][\s.!?:;]*$/i.test(lastLine)) {
    return lastLine[0]!.toUpperCase();
  }

  // Explicit conclusion phrases beat option-list mentions (A) Ag, B) Au, …)
  const answerPatterns = [
    /(?:final\s+(?:answer|response|choice)|construct\s+final\s+response|correct\s+(?:answer|option|choice)|answer\s+is|option|choice)\s*[:\-—*]*\s*([A-D])\b/i,
    /\b([A-D])\s*(?:is\s+)?(?:correct|right)\b/i,
  ];
  for (const pattern of answerPatterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }

  // Last standalone letter — avoids scoring "A) Ag" at the start of option walkthroughs
  const letters = [...trimmed.matchAll(/\b([A-D])\b/gi)];
  if (letters.length > 0) {
    return letters[letters.length - 1]![1]!.toUpperCase();
  }

  return trimmed.toUpperCase().slice(0, 1);
}

/** True when the letter maps to a valid choice index for this item. */
function isLetterInChoiceRange(letter: string, choiceCount: number | undefined): boolean {
  if (!choiceCount || choiceCount <= 0) return true;
  if (!letter || !/^[A-Z]$/.test(letter)) return false;
  const index = letter.charCodeAt(0) - 65;
  return index >= 0 && index < choiceCount;
}

export function scoreMcq(item: StandardBenchmarkItem, response: string): StandardScoreResult {
  const expected = normalizeLetter(item.groundTruth);
  const actual = normalizeLetter(response);
  const choiceCount = item.choices?.length;

  if (choiceCount && !isLetterInChoiceRange(expected, choiceCount)) {
    return {
      passed: false,
      score: 0,
      details: `Ground truth ${expected} is out of range for ${choiceCount} choices`,
    };
  }

  const passed = actual === expected;
  const actualNote =
    actual && choiceCount && !isLetterInChoiceRange(actual, choiceCount)
      ? `${actual} (out of range)`
      : actual || '(empty)';

  return {
    passed,
    score: passed ? 1 : 0,
    details: passed ? undefined : `Expected ${expected}, got ${actualNote}`,
  };
}
