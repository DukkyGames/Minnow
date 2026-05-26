/**
 * Static benchmark test descriptions keyed by testId (exact or pattern).
 *
 * Resolution order: exact static entry → suite-specific dynamic resolver
 * (tool-*, skill-*, mode-*, speed-short-*) → null.
 */

import builtinManifest from '../skills/builtin-manifest.json';
import { listModes } from '../chat/modes/registry.ts';
import type { ModeId } from '../chat/modes/types.ts';
import { BUILT_IN_TOOLS } from '../tools/definitions.ts';
import { formatSkillPassCriteria, getSkillProbe } from './suites/skill-probes.ts';
import type { SuiteId } from './types.ts';

export interface BenchmarkTestDescription {
  testId: string;
  suite: SuiteId;
  label?: string;
  purpose: string;
  method: string;
  passCriteria: string;
}

export interface ExpectedBenchmarkTest {
  testId: string;
  suite: SuiteId;
  label: string;
}

/** One-line helper under each suite header on the benchmark page. */
export const SUITE_INTROS: Record<SuiteId, string> = {
  capability:
    'Provider wiring, streaming, usage metadata, tool schema acceptance, model catalog, and optional vision probes.',
  speed:
    'Median time-to-first-token and tokens-per-second from fixed prompts; pass means a non-empty completion, not answer quality.',
  tools:
    'One serial tool round-trip per built-in tool: model must emit the tool with fixture args; server runs it when required.',
  skills:
    'Built-in slash skills load into the system prompt; each probe checks observable behavior (tool call or skill-specific regex), not acknowledgment only.',
  modes:
    'Composer mode tool policy: forbidden tools must not run on negative probes; expected tools must emit on positive probes.',
  coding:
    'Deterministic coding puzzles plus two LLM-judged explanation/refactor tasks scored by a second model pass.',
};

const CAPABILITY_DESCRIPTIONS: Record<string, Omit<BenchmarkTestDescription, 'testId' | 'suite'>> = {
  'cap-provider': {
    purpose: 'Checks that the active provider record resolves and exposes a base URL.',
    method: 'Loads provider config from the store without calling the model.',
    passCriteria: 'Provider id and base URL are present.',
  },
  'cap-model': {
    purpose: 'Confirms a model id is bound for this benchmark run.',
    method: 'Reads the model id from the run context (same as the header picker).',
    passCriteria: 'Model id string is non-empty.',
  },
  'cap-stream': {
    purpose: 'Verifies streamed chat completions return visible assistant text.',
    method: 'One-shot stream with a minimal hello user prompt and low max tokens.',
    passCriteria: 'Completion text is non-empty after the stream finishes.',
  },
  'cap-usage': {
    purpose: 'Detects token usage fields in the completion stream when the provider reports them.',
    method: 'Short count-to-three prompt; inspects usage on the final chunk.',
    passCriteria:
      'Pass when completion or total token counts appear. Skip (not a failure) when the provider omits usage metadata.',
  },
  'cap-tools-schema': {
    purpose: 'Ensures the provider accepts an OpenAI-style tools array on the request.',
    method: 'Single completion with a calculate tool schema; answer may be text-only.',
    passCriteria: 'Request completes without a schema or tools rejection error.',
  },
  'cap-models-list': {
    purpose: 'Validates the provider models catalog endpoint returns entries.',
    method: 'Fetches models for the active provider once (reused for multimodal gating).',
    passCriteria: 'Non-empty models array.',
  },
  'cap-multimodal': {
    purpose: 'Exercises image+text input when the active model is marked vision-capable.',
    method: 'Sends a tiny inline image probe when the catalog marks the model as vision.',
    passCriteria:
      'Pass when the model returns scored probe text. Skip when the model is text-only (not a vision model).',
  },
};

const SPEED_LONG_DESCRIPTION: Omit<BenchmarkTestDescription, 'testId' | 'suite'> = {
  purpose: 'Measures sustained tokens-per-second on a longer generation.',
  method: 'Fixed ~400-word transformer explainer prompt with a higher max token budget.',
  passCriteria:
    'Non-empty completion text. Throughput in details is informational; char count alone does not fail the test.',
};

const CODING_DESCRIPTIONS: Record<string, Omit<BenchmarkTestDescription, 'testId' | 'suite'>> = {
  'code-fizzbuzz': {
    purpose: 'Checks multi-step reasoning on a classic FizzBuzz line output.',
    method: 'Model emits a Node script; benchmark runs it via run_javascript and checks stdout.',
    passCriteria:
      'Fifteen comma-separated tokens from 1 through FizzBuzz on stdout (15 is FizzBuzz).',
  },
  'code-reverse': {
    purpose: 'Validates exact string manipulation without extra prose.',
    method: 'Model script reverses "minnow"; stdout must be wonnim.',
    passCriteria: 'Executed stdout matches "wonnim" exactly (after trim).',
  },
  'code-fib': {
    purpose: 'Tests numeric recall for a standard Fibonacci index.',
    method: 'Model script prints F(10); benchmark runs and reads stdout.',
    passCriteria: 'Stdout is or contains 55.',
  },
  'code-json': {
    purpose: 'Checks JSON-shaped output and key reordering.',
    method: 'Model script prints swapped JSON; stdout is parsed.',
    passCriteria: 'Stdout is JSON with both "a" and "b" keys.',
  },
  'code-regex': {
    purpose: 'Extracts a structured substring with regex-friendly output.',
    method: 'Model script extracts email; stdout is checked.',
    passCriteria: 'Stdout includes team@minnow.dev.',
  },
  'code-sql': {
    purpose: 'Produces a minimal SQL filter query.',
    method: 'Ask for names from users where active is true.',
    passCriteria: 'Contains SELECT and users (case-insensitive).',
  },
  'code-bug': {
    purpose: 'Spots and fixes an obvious arithmetic bug in a function.',
    method: 'Model script defines fixed add and prints add(2,3); benchmark runs it.',
    passCriteria: 'Stdout is 5.',
  },
  'code-type': {
    purpose: 'Explains a TypeScript generic type parameter in plain language.',
    method: 'One-sentence explanation of T in identity<T>.',
    passCriteria: 'Mentions generics, type parameters, or placeholders.',
  },
  'code-judge-explain': {
    purpose: 'Judged explanation quality for a short recursion summary.',
    method: 'Model answers, then a second grading pass scores JSON {pass, reason}.',
    passCriteria: 'Judge pass flag is true for a sensible two-sentence explanation.',
  },
  'code-judge-refactor': {
    purpose: 'Judged suggestion quality for a small array pipeline refactor.',
    method: 'Model suggests an improvement; inline judge grades the answer.',
    passCriteria: 'Judge pass flag is true for a relevant refactor hint.',
  },
};

/** Mirrors negative probes in suites/modes.ts (keep in sync). */
const MODE_NEGATIVE: Partial<Record<ModeId, { forbiddenTool: string }>> = {
  plan: { forbiddenTool: 'delete_path' },
  research: { forbiddenTool: 'git_commit' },
};

/** Mirrors positive probes in suites/modes.ts (keep in sync). */
const MODE_POSITIVE: Partial<Record<ModeId, { expectedTool: string }>> = {
  general: { expectedTool: 'read_file' },
  build: { expectedTool: 'list_directory' },
  plan: { expectedTool: 'read_file' },
  research: { expectedTool: 'web_search' },
  orchestrate: { expectedTool: 'list_directory' },
  reef: { expectedTool: 'get_datetime' },
};

function withIds(
  suite: SuiteId,
  map: Record<string, Omit<BenchmarkTestDescription, 'testId' | 'suite'>>,
): Record<string, BenchmarkTestDescription> {
  const out: Record<string, BenchmarkTestDescription> = {};
  for (const [testId, body] of Object.entries(map)) {
    out[testId] = { testId, suite, ...body };
  }
  return out;
}

const STATIC_BY_ID: Record<string, BenchmarkTestDescription> = {
  ...withIds('capability', CAPABILITY_DESCRIPTIONS),
  ...withIds('coding', CODING_DESCRIPTIONS),
  'speed-long-1': { testId: 'speed-long-1', suite: 'speed', ...SPEED_LONG_DESCRIPTION },
};

function speedShortDescription(index: number): BenchmarkTestDescription {
  return {
    testId: `speed-short-${index}`,
    suite: 'speed',
    purpose: `Samples time-to-first-token and throughput on short fixed prompt ${index} of 3.`,
    method: 'Streaming one-shot with the same short local-LLM paragraph prompt.',
    passCriteria:
      'Non-empty completion. TTFT/tok/s in meta are informational; zero chars in details can still pass when timing succeeded.',
  };
}

function resolveToolDescription(testId: string, label: string): BenchmarkTestDescription | null {
  const toolId = testId.slice('tool-'.length);
  const tool = BUILT_IN_TOOLS.find((t) => t.id === toolId);
  if (!tool) return null;

  const serverNote = tool.serverRequired
    ? ' Skips when Minnow tool server is offline (run npm start).'
    : '';
  const emitNote = tool.serverRequired
    ? ' Server executes the tool when a call is emitted.'
    : ' Browser-native or emit-only tools may skip server execution.';

  return {
    testId,
    suite: 'tools',
    label,
    purpose: tool.description || `Checks the model can call the ${tool.label} tool.`,
    method: `Fixture user prompt steers a single tool round-trip for \`${toolId}\`.${emitNote}`,
    passCriteria: `Model emits \`${toolId}\` with expected arguments; execution succeeds when required.${serverNote}`,
  };
}

function resolveSkillDescription(testId: string, label: string): BenchmarkTestDescription | null {
  const skillId = testId.slice('skill-'.length);
  const skill = (builtinManifest.skills ?? []).find((s) => s.id === skillId);
  if (!skill) return null;

  const probe = getSkillProbe(skillId);
  const toolNote =
    probe.toolIds?.length && probe.passKind !== 'regex'
      ? ` Tool allowlist: ${probe.toolIds.join(', ')}.`
      : '';

  return {
    testId,
    suite: 'skills',
    label,
    purpose: skill.description || `Validates the ${skill.label} built-in skill shapes the reply.`,
    method: `Loads SKILL.md into the system prompt, then sends the skill-specific probe prompt.${toolNote} Skips when the skill body cannot be loaded.`,
    passCriteria: formatSkillPassCriteria(probe),
  };
}

function resolveModeDescription(testId: string, label: string): BenchmarkTestDescription | null {
  const negMatch = /^mode-(.+)-negative$/.exec(testId);
  if (negMatch) {
    const modeId = negMatch[1] as ModeId;
    const spec = MODE_NEGATIVE[modeId];
    if (!spec) return null;
    const mode = listModes().find((m) => m.id === modeId);
    return {
      testId,
      suite: 'modes',
      label,
      purpose: `${mode?.label ?? modeId} mode must block destructive or disallowed tool use.`,
      method: `User prompt requests \`${spec.forbiddenTool}\`; mode system prompt and tool policy apply.`,
      passCriteria: `The forbidden tool \`${spec.forbiddenTool}\` must not appear in tool calls.`,
    };
  }

  const posMatch = /^mode-(.+)-positive$/.exec(testId);
  if (posMatch) {
    const modeId = posMatch[1] as ModeId;
    const spec = MODE_POSITIVE[modeId];
    if (!spec) return null;
    const mode = listModes().find((m) => m.id === modeId);
    const webSkip =
      spec.expectedTool === 'web_search'
        ? ' Skips when the tool server is unavailable (web_search needs npm start).'
        : '';
    return {
      testId,
      suite: 'modes',
      label,
      purpose: `${mode?.label ?? modeId} mode should allow and emit an expected everyday tool.`,
      method: `User prompt asks for \`${spec.expectedTool}\` with mode system prompt enabled.`,
      passCriteria: `A tool call named \`${spec.expectedTool}\` is present.${webSkip}`,
    };
  }

  return null;
}

/** Plain-language card copy: purpose, method, pass line (kept under ~320 chars when possible). */
export function formatTestCardDescription(desc: BenchmarkTestDescription): string {
  return `${desc.purpose} ${desc.method} Pass: ${desc.passCriteria}`;
}

/**
 * Resolve helper copy for a benchmark test card.
 */
export function resolveTestDescription(
  testId: string,
  suite: SuiteId,
  label: string,
): BenchmarkTestDescription | null {
  const exact = STATIC_BY_ID[testId];
  if (exact) return { ...exact, label: exact.label ?? label };

  const shortMatch = /^speed-short-([1-3])$/.exec(testId);
  if (shortMatch) {
    const d = speedShortDescription(Number(shortMatch[1]));
    return { ...d, label };
  }

  if (testId.startsWith('tool-')) {
    return resolveToolDescription(testId, label);
  }
  if (testId.startsWith('skill-')) {
    return resolveSkillDescription(testId, label);
  }
  if (testId.startsWith('mode-')) {
    return resolveModeDescription(testId, label);
  }

  if (suite === 'speed' && testId === 'speed-long-1') {
    return { ...SPEED_LONG_DESCRIPTION, testId, suite: 'speed', label };
  }

  return null;
}

function expectedCapabilityTests(): ExpectedBenchmarkTest[] {
  return [
    { testId: 'cap-provider', suite: 'capability', label: 'Provider reachable' },
    { testId: 'cap-model', suite: 'capability', label: 'Active model selected' },
    { testId: 'cap-stream', suite: 'capability', label: 'Streaming completion' },
    { testId: 'cap-usage', suite: 'capability', label: 'Usage metadata' },
    { testId: 'cap-tools-schema', suite: 'capability', label: 'Tool schema accepted' },
    { testId: 'cap-models-list', suite: 'capability', label: 'Models list' },
    { testId: 'cap-multimodal', suite: 'capability', label: 'Multimodal request' },
  ];
}

function expectedSpeedTests(): ExpectedBenchmarkTest[] {
  return [
    { testId: 'speed-short-1', suite: 'speed', label: 'Short run 1' },
    { testId: 'speed-short-2', suite: 'speed', label: 'Short run 2' },
    { testId: 'speed-short-3', suite: 'speed', label: 'Short run 3' },
    { testId: 'speed-long-1', suite: 'speed', label: 'Sustained throughput' },
  ];
}

const CODING_LABELS: Record<string, string> = {
  'code-fizzbuzz': 'FizzBuzz line',
  'code-reverse': 'Reverse string',
  'code-fib': 'Fibonacci(10)',
  'code-json': 'JSON transform',
  'code-regex': 'Regex extract',
  'code-sql': 'SQL hint',
  'code-bug': 'Spot bug',
  'code-type': 'Type signature',
  'code-judge-explain': 'Explain (judged)',
  'code-judge-refactor': 'Refactor (judged)',
};

function expectedCodingTests(): ExpectedBenchmarkTest[] {
  return Object.keys(CODING_DESCRIPTIONS).map((testId) => ({
    testId,
    suite: 'coding' as const,
    label: CODING_LABELS[testId] ?? testId,
  }));
}

function expectedToolsTests(): ExpectedBenchmarkTest[] {
  return BUILT_IN_TOOLS.map((tool) => ({
    testId: `tool-${tool.id}`,
    suite: 'tools' as const,
    label: tool.label,
  }));
}

function expectedSkillsTests(): ExpectedBenchmarkTest[] {
  return (builtinManifest.skills ?? []).map((skill) => ({
    testId: `skill-${skill.id}`,
    suite: 'skills' as const,
    label: skill.label,
  }));
}

function expectedModesTests(): ExpectedBenchmarkTest[] {
  const tests: ExpectedBenchmarkTest[] = [];
  for (const mode of listModes()) {
    const modeId = mode.id as ModeId;
    if (MODE_NEGATIVE[modeId]) {
      tests.push({
        testId: `mode-${modeId}-negative`,
        suite: 'modes',
        label: `${mode.label} denies ${MODE_NEGATIVE[modeId]!.forbiddenTool}`,
      });
    }
    if (MODE_POSITIVE[modeId]) {
      tests.push({
        testId: `mode-${modeId}-positive`,
        suite: 'modes',
        label: `${mode.label} emits ${MODE_POSITIVE[modeId]!.expectedTool}`,
      });
    }
  }
  return tests;
}

const SUITE_TEST_LISTERS: Record<SuiteId, () => ExpectedBenchmarkTest[]> = {
  capability: expectedCapabilityTests,
  speed: expectedSpeedTests,
  tools: expectedToolsTests,
  skills: expectedSkillsTests,
  modes: expectedModesTests,
  coding: expectedCodingTests,
};

/** All test ids the runner emits for the given suites (for coverage tests and future pre-run UI). */
export function listExpectedTestsForSuites(suiteIds: SuiteId[]): ExpectedBenchmarkTest[] {
  const out: ExpectedBenchmarkTest[] = [];
  for (const suiteId of suiteIds) {
    const lister = SUITE_TEST_LISTERS[suiteId];
    if (lister) out.push(...lister());
  }
  return out;
}

/** Full battery test ids (all six suites). */
export function listAllExpectedBenchmarkTests(): ExpectedBenchmarkTest[] {
  return listExpectedTestsForSuites([
    'capability',
    'speed',
    'tools',
    'skills',
    'modes',
    'coding',
  ]);
}
