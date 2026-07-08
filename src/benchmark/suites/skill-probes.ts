/**
 * Per built-in skill: trigger prompt, pass kind, and scoring rules for the Skills suite.
 */

import { getToolById } from '../../tools/definitions.ts';
import type { OpenAIFunctionDefinition } from '../../tools/definitions.ts';
import type { ToolCall } from '../../types.ts';
import { regexMatch, toolNameMatch } from '../scoring.ts';
import type { BenchmarkRunContext } from '../types.ts';

/** How a skill probe decides pass/fail. */
export type SkillPassKind = 'regex' | 'tool' | 'tool-or-regex';

export interface SkillProbe {
  skillId: string;
  prompt: string;
  passKind: SkillPassKind;
  /** Required for regex and tool-or-regex text fallback. */
  pattern?: RegExp;
  /** Required for tool and tool-or-regex; any listed tool name satisfies. */
  expectedTools?: string[];
  /** When set, at least one matching tool call must satisfy this predicate. */
  expectToolArgs?: (toolName: string, args: Record<string, unknown>) => boolean;
  /** Minimal tool allowlist passed to the model (resolved to OpenAI definitions). */
  toolIds?: string[];
  /** Skip when tool server is not up (`npm start`). */
  requiresLocalServer?: boolean;
  /** Optional skip predicate (e.g. browser CDP unavailable). */
  skipWhen?: (ctx: BenchmarkRunContext) => string | null;
}

function askQuestionArgsValid(args: Record<string, unknown>): boolean {
  const questions = args.questions;
  if (!Array.isArray(questions) || questions.length === 0) return false;
  const first = questions[0] as Record<string, unknown>;
  if (typeof first.prompt !== 'string' || !first.prompt.trim()) return false;
  const options = first.options;
  return (
    Array.isArray(options) &&
    options.length >= 2 &&
    options.every(
      (o) =>
        o &&
        typeof o === 'object' &&
        typeof (o as { id?: unknown }).id === 'string' &&
        typeof (o as { label?: unknown }).label === 'string',
    )
  );
}

/** One probe per built-in skill id in `builtin-manifest.json`. */
export const SKILL_PROBES: Record<string, SkillProbe> = {
  'ask-user': {
    skillId: 'ask-user',
    prompt:
      'I need to choose between REST and GraphQL for a small API. Call ask_question now with 2–4 structured questions (each needs prompt and options as {id, label}). Use the tool only.',
    passKind: 'tool',
    expectedTools: ['ask_question'],
    toolIds: ['ask_question'],
    expectToolArgs: (name, args) => name === 'ask_question' && askQuestionArgsValid(args),
  },
  'explain-code': {
    skillId: 'explain-code',
    prompt: 'Explain what Array.prototype.map does in one short paragraph for a junior developer.',
    passKind: 'regex',
    pattern: /\bmap\b.*\b(callback|element|array)\b|\bcallback\b.*\bmap\b/i,
  },
  'debug-error': {
    skillId: 'debug-error',
    prompt:
      'A tool failed with Error: ENOENT: no such file or directory. List the first three checks you would run.',
    passKind: 'regex',
    pattern: /ENOENT|path|file|exist|missing|read_file|list_directory/i,
  },
  impeccable: {
    skillId: 'impeccable',
    prompt:
      'The login button on the settings page feels cramped against the card edge. What visual changes would you suggest?',
    passKind: 'regex',
    pattern: /spacing|padding|margin|layout|hierarchy|touch|align|button|visual/i,
  },
  'browser-automation': {
    skillId: 'browser-automation',
    prompt:
      'Before navigating externally, what do you check first for Chrome CDP? Call browser_list now. Use the tool only.',
    passKind: 'tool',
    expectedTools: ['browser_list'],
    toolIds: ['browser_list'],
    requiresLocalServer: true,
  },
  caveman: {
    skillId: 'caveman',
    prompt:
      'Why does a React component re-render when an inline object is passed as a prop? Answer in caveman full mode: short fragments, no filler, no pleasantries.',
    passKind: 'regex',
    pattern:
      /re-?render|ref|useMemo|object|prop|inline|memo/i,
  },
  'code-review': {
    skillId: 'code-review',
    prompt: `Review this snippet and respond using the skill output format (Summary plus at least one findings section):

\`\`\`ts
export function divide(a: number, b: number) {
  return a / b;
}
\`\`\``,
    passKind: 'regex',
    pattern: /##\s*(Summary|Blockers|Suggestions|Nits)\b/i,
  },
  'docs-update': {
    skillId: 'docs-update',
    prompt:
      'We shipped a new GET /api/benchmarks route. Which Minnow docs files should you update first and what sections would you touch?',
    passKind: 'regex',
    pattern: /context\.md|README|documentation\/|architecture|API|route/i,
  },
  'git-commit': {
    skillId: 'git-commit',
    prompt:
      'I may have staged fixes. Call git_status first, then suggest a conventional commit subject line for a bugfix (imperative, ≤72 chars). Use git tools when needed.',
    passKind: 'tool-or-regex',
    expectedTools: ['git_status', 'git_diff'],
    toolIds: ['git_status', 'git_diff'],
    pattern: /^(feat|fix|docs|style|refactor|test|chore)(\(.+\))?:\s+\S+/im,
  },
  'refactor-safe': {
    skillId: 'refactor-safe',
    prompt:
      'I want to extract a helper from a 200-line function without changing behavior. Outline your refactor-safe steps in order.',
    passKind: 'regex',
    pattern: /test|behavior|minimal|small|diff|incremental|verify/i,
  },
  'security-review': {
    skillId: 'security-review',
    prompt:
      'Review for security: `const q = "SELECT * FROM users WHERE id=" + req.params.id`. Name the top risks and mitigations.',
    passKind: 'regex',
    pattern: /SQL|injection|parameter|sanitize|validate|OWASP|secret|bind/i,
  },
  'ui-designer': {
    skillId: 'ui-designer',
    prompt:
      'Audit the Minnow chat header spacing. What is your first concrete step per the UI designer skill (tools or capture)?',
    passKind: 'regex',
    pattern: /screenshot|browser_|read_file|PRODUCT|DESIGN|impeccable|spacing|audit|capture/i,
  },
  'write-tests': {
    skillId: 'write-tests',
    prompt:
      'I need a unit test for a date-formatting helper. Which principles from the write-tests skill must the test follow?',
    passKind: 'regex',
    pattern: /deterministic|hardcoded|fixture|node --test|repeatable|static expected/i,
  },
  'ask-minnow': {
    skillId: 'ask-minnow',
    prompt:
      'I have a pile of bug reports and a vague feature idea. Which Minnow skill or flow should I start with, and why?',
    passKind: 'regex',
    pattern: /triage|grill|implement|flow|skill|\/[a-z-]+/i,
  },
  'codebase-design': {
    skillId: 'codebase-design',
    prompt:
      'A module exposes twenty functions and callers reach through three layers. How would codebase-design vocabulary describe the fix?',
    passKind: 'regex',
    pattern: /deep module|interface|abstraction|seam|narrow|surface area/i,
  },
  'diagnosing-bugs': {
    skillId: 'diagnosing-bugs',
    prompt:
      'A flaky test fails only in CI. Outline the diagnosing-bugs loop you would run before changing production code.',
    passKind: 'regex',
    pattern: /reproduce|hypothesis|bisect|isolate|root cause|narrow|instrument/i,
  },
  'domain-modeling': {
    skillId: 'domain-modeling',
    prompt:
      'The team uses "order", "cart", and "checkout" inconsistently. What domain-modeling artifacts would you create first?',
    passKind: 'regex',
    pattern: /domain|ubiquitous|glossary|terminology|ADR|language|model/i,
  },
  'git-setup': {
    skillId: 'git-setup',
    prompt:
      'This folder has code but no git history. What git-setup steps do you run before connecting GitHub?',
    passKind: 'regex',
    pattern: /git init|remote|GitHub|repository|version control|branch/i,
  },
  'grill-me': {
    skillId: 'grill-me',
    prompt:
      'I want to build a collaborative whiteboard. Grill my plan with sharp questions before I write code.',
    passKind: 'regex',
    pattern: /\?|assumption|clarify|challenge|risk|scope|why|how/i,
  },
  'grill-with-docs': {
    skillId: 'grill-with-docs',
    prompt:
      'We are designing a billing module. Start grilling and tell me which docs you will update as we go.',
    passKind: 'regex',
    pattern: /CONTEXT\.md|ADR|glossary|interview|question|document/i,
  },
  grilling: {
    skillId: 'grilling',
    prompt:
      'Stress-test this design before we build: a single JSON file stores all user settings. What do you challenge first?',
    passKind: 'regex',
    pattern: /grill|question|assumption|risk|plan|design|clarify/i,
  },
  handoff: {
    skillId: 'handoff',
    prompt:
      'Compact this thread for a fresh agent who will continue the refactor. What sections must the handoff include?',
    passKind: 'regex',
    pattern: /handoff|next session|suggested skills|temporary|summary|context/i,
  },
  implement: {
    skillId: 'implement',
    prompt:
      'You have a PRD and one tracer-bullet issue. How does the implement skill sequence work from branch to verification?',
    passKind: 'regex',
    pattern: /implement|issue|PRD|branch|test|verify|commit|slice/i,
  },
  'improve-codebase-architecture': {
    skillId: 'improve-codebase-architecture',
    prompt:
      'Scan this repo for deepening opportunities. What deliverable does improve-codebase-architecture produce before grilling?',
    passKind: 'regex',
    pattern: /HTML|report|deepen|architecture|scan|grill|opportunit/i,
  },
  partymode: {
    skillId: 'partymode',
    prompt:
      'Party mode on: explain why async iterators are cool. Stay in Bird Man persona with maximum vibes.',
    passKind: 'regex',
    pattern: /Bird Man|party|vibes|dude|bro|async|iterator/i,
  },
  prototype: {
    skillId: 'prototype',
    prompt:
      'I cannot decide between two state machines for checkout. How would the prototype skill answer that without shipping production code?',
    passKind: 'regex',
    pattern: /prototype|throwaway|runnable|terminal|toggle|variation|experiment/i,
  },
  'resolving-merge-conflicts': {
    skillId: 'resolving-merge-conflicts',
    prompt:
      'I am mid-rebase and see conflict markers in auth.ts. What resolving-merge-conflicts steps do you take?',
    passKind: 'regex',
    pattern: /conflict|merge|<<<<|rebase|ours|theirs|marker|resolve/i,
  },
  'setup-minnow-skills': {
    skillId: 'setup-minnow-skills',
    prompt:
      'First time using Matt Pocock engineering skills in this repo. What does setup-minnow-skills configure?',
    passKind: 'regex',
    pattern: /issue tracker|triage|label|domain doc|setup|vocabulary|configure/i,
  },
  tdd: {
    skillId: 'tdd',
    prompt:
      'Add a feature to parse ISO dates. Describe the red-green-refactor loop you would follow.',
    passKind: 'regex',
    pattern: /red|green|refactor|test-first|TDD|failing test|write.*test/i,
  },
  teach: {
    skillId: 'teach',
    prompt:
      'Teach me how git rebase works in this workspace with a short exercise.',
    passKind: 'regex',
    pattern: /teach|learn|exercise|concept|explain|practice|step/i,
  },
  'to-issues': {
    skillId: 'to-issues',
    prompt:
      'We have a PRD for notifications. How does to-issues split it into independently grabbable work?',
    passKind: 'regex',
    pattern: /issue|tracer|vertical slice|independent|tracker|slice|grabbable/i,
  },
  'to-prd': {
    skillId: 'to-prd',
    prompt:
      'Turn our discussion into a PRD on the issue tracker. What does to-prd synthesize without re-interviewing me?',
    passKind: 'regex',
    pattern: /PRD|issue tracker|synthesis|publish|requirements|document/i,
  },
  triage: {
    skillId: 'triage',
    prompt:
      'An external bug report says "export crashes sometimes". What triage states and roles do you apply?',
    passKind: 'regex',
    pattern: /triage|ready-for-agent|needs-info|bug|enhancement|needs-triage|role/i,
  },
  'writing-great-skills': {
    skillId: 'writing-great-skills',
    prompt:
      'I am drafting a new agent skill. What principles from writing-great-skills make it predictable?',
    passKind: 'regex',
    pattern: /skill|predictable|vocabulary|principle|structure|trigger|instruction/i,
  },
};

export function getSkillProbe(skillId: string): SkillProbe {
  const probe = SKILL_PROBES[skillId];
  if (!probe) {
    return {
      skillId,
      prompt: `Apply the ${skillId} skill to the user request. Follow the skill instructions; do not only acknowledge them.`,
      passKind: 'regex',
      pattern: new RegExp(skillId.replace(/-/g, '[\\s-]'), 'i'),
    };
  }
  return probe;
}

export function listSkillProbeIds(): string[] {
  return Object.keys(SKILL_PROBES);
}

/** OpenAI tool definitions for a probe allowlist (unknown ids omitted). */
export function resolveSkillProbeTools(probe: SkillProbe): OpenAIFunctionDefinition[] {
  if (!probe.toolIds?.length) return [];
  const defs: OpenAIFunctionDefinition[] = [];
  for (const id of probe.toolIds) {
    const tool = getToolById(id);
    if (tool) defs.push(tool.definition);
  }
  return defs;
}

export function resolveSkillProbeSkip(
  probe: SkillProbe,
  ctx: BenchmarkRunContext,
): string | null {
  if (probe.requiresLocalServer && !ctx.localServer) {
    return 'needs npm start (tool server)';
  }
  return probe.skipWhen?.(ctx) ?? null;
}

export interface SkillProbeEvaluation {
  passed: boolean;
  details: string;
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* invalid JSON */
  }
  return {};
}

function toolProbePassed(
  probe: SkillProbe,
  toolCalls: ToolCall[],
): { ok: boolean; details: string } {
  const expected = probe.expectedTools ?? [];
  if (expected.length === 0) {
    return { ok: false, details: 'probe misconfigured: no expectedTools' };
  }

  const matchedName = expected.find((name) => toolNameMatch(toolCalls, name));
  if (!matchedName) {
    const names = toolCalls.map((tc) => tc.function.name).join(', ') || '(none)';
    return { ok: false, details: `expected ${expected.join('|')}, got ${names}` };
  }

  if (probe.expectToolArgs) {
    const call = toolCalls.find((tc) => tc.function.name === matchedName);
    const args = parseToolArgs(call?.function.arguments ?? '');
    if (!probe.expectToolArgs(matchedName, args)) {
      return { ok: false, details: `${matchedName} args invalid` };
    }
    return { ok: true, details: `${matchedName} called with valid args` };
  }

  return { ok: true, details: `${matchedName} called` };
}

/** Score a completed one-shot or tool-loop turn against the probe definition. */
export function evaluateSkillProbe(
  probe: SkillProbe,
  out: { text: string; toolCalls: ToolCall[] },
): SkillProbeEvaluation {
  const text = out.text.trim();

  if (probe.passKind === 'tool') {
    const toolResult = toolProbePassed(probe, out.toolCalls);
    return { passed: toolResult.ok, details: toolResult.details };
  }

  if (probe.passKind === 'tool-or-regex') {
    const toolResult = toolProbePassed(probe, out.toolCalls);
    if (toolResult.ok) return { passed: true, details: toolResult.details };
    if (probe.pattern && text && regexMatch(text, probe.pattern)) {
      return { passed: true, details: 'commit subject matched regex' };
    }
    if (!text) {
      return { passed: false, details: `empty response; ${toolResult.details}` };
    }
    return {
      passed: false,
      details: `${toolResult.details}; text did not match pattern`,
    };
  }

  if (!text) {
    return { passed: false, details: 'empty response' };
  }
  if (!probe.pattern) {
    return { passed: false, details: 'probe misconfigured: no pattern' };
  }
  const passed = regexMatch(text, probe.pattern);
  return {
    passed,
    details: passed ? 'text matched skill pattern' : 'text did not match skill pattern',
  };
}

/** Human-readable pass line for benchmark test cards. */
export function formatSkillPassCriteria(probe: SkillProbe): string {
  if (probe.passKind === 'tool') {
    const tools = (probe.expectedTools ?? []).join(' or ');
    const argsNote = probe.expectToolArgs ? ' with valid tool arguments' : '';
    const serverNote = probe.requiresLocalServer ? ' Skips when tool server is down.' : '';
    return `Model calls \`${tools}\`${argsNote}.${serverNote}`;
  }
  if (probe.passKind === 'tool-or-regex') {
    const tools = (probe.expectedTools ?? []).join(' or ');
    return `Model calls \`${tools}\` or reply matches the skill-specific regex (e.g. conventional commit subject).`;
  }
  return 'Non-empty assistant reply matches the skill-specific regex (observable skill behavior, not acknowledgment only).';
}
