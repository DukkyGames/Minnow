/**
 * User-facing copy for the Benchmark app (labels, empty states, status text).
 * Keep terminology consistent: "run" not "campaign", "Minnow tests" for integration suites.
 */

import type { SuiteId } from '../../benchmark/types.ts';

/** Short names for integration test suites (Run tab + transcript). */
export const SUITE_LABELS: Record<SuiteId, string> = {
  capability: 'Capability',
  'capability-matrix': 'Capability matrix',
  speed: 'Speed',
  tools: 'Tools',
  skills: 'Skills',
  coding: 'Coding',
};

/** One-line hint for each integration suite (Run tab tooltips). */
export const SUITE_HINTS: Record<SuiteId, string> = {
  capability: 'Reasoning, JSON, and multimodal probes',
  'capability-matrix': 'Spreadsheet capability grid (Settings)',
  speed: 'Time to first token and tokens per second',
  tools: 'Built-in tool calls in an isolated workspace',
  skills: 'Slash-command skill behavior',
  coding: 'Generate and run small Node scripts',
};

/** Tests tab family filter labels (data-family values stay lowercase in markup). */
export const TEST_FAMILY_LABELS: Record<'all' | 'integration' | 'standard' | 'custom', string> = {
  all: 'All',
  integration: 'Minnow tests',
  standard: 'Academic',
  custom: 'Custom',
};

/** Badge text in the catalog list and drawer. */
export function catalogFamilyLabel(family: 'integration' | 'standard' | 'custom'): string {
  if (family === 'integration') return 'Minnow test';
  if (family === 'standard') return 'Academic';
  return 'Custom';
}

/** Overview grid column headers (compact instrumentation labels). */
export const OVERVIEW_COLUMNS = {
  model: 'Model',
  tokPerSec: 'Tok/s',
  ttft: 'TTFT',
  quality: 'Quality',
} as const;
