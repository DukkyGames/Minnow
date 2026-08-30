/**
 * P2-E — the structured report tool (MIN-702).
 *
 * V1 inferred why an agent stopped by scraping the transcript
 * (`orchestrate-failure-classify.ts`, 303 lines of `ECONNREFUSED` / `spawn ELOOP`
 * markers). The replacement is not a better classifier. It is asking the agent,
 * and rejecting a malformed answer at the tool boundary so it can retry inside
 * the same turn.
 *
 * A rejected report is **not** `no_report`. `no_report` means the tool was never
 * called at all. That distinction is what lets the policy table's continue-seed
 * row stay about vanished agents rather than about JSON typos.
 *
 * Lives here, not in `server/runner/`, because the schemas are role-specific
 * (Builder has `blocked`; Tester does not) and the runner must not know what a
 * role is. Pass the tool + `parseReport` into `runTurn({ tools, parseReport })`.
 */

/** Same name `runTurn` injects by default. Not a role name. */
export const REPORT_TOOL_NAME = 'report_outcome';

const BUILDER_OUTCOMES = new Set(['pass', 'fail', 'blocked']);
const TESTER_OUTCOMES = new Set(['pass', 'fail']);

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, error: string }}
 */
function coerceObject(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        error:
          'Error: report_outcome arguments must be a JSON object. The string you sent was not valid JSON. Retry with a single JSON object.',
      };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return {
      ok: false,
      error:
        'Error: report_outcome requires a JSON object. Retry with an object, not an array or primitive.',
    };
  }
  return { ok: true, value: /** @type {Record<string, unknown>} */ (obj) };
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {{ ok: true, value: string[] } | { ok: false, error: string }}
 */
function requireStringArray(value, field) {
  if (value === undefined) {
    return {
      ok: false,
      error: `Error: report_outcome requires "${field}", an array of strings (use [] if there are none). Retry and include ${field}.`,
    };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: `Error: report_outcome "${field}" must be an array of strings. You sent ${typeof value}. Retry with an array.`,
    };
  }
  for (let i = 0; i < value.length; i += 1) {
    if (typeof value[i] !== 'string') {
      return {
        ok: false,
        error: `Error: report_outcome "${field}[${i}]" must be a string. Retry with an array of strings.`,
      };
    }
  }
  return { ok: true, value };
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function requireNonEmptySummary(value) {
  if (typeof value !== 'string') {
    return {
      ok: false,
      error: 'Error: report_outcome requires "summary" as a non-empty string. Retry and include summary.',
    };
  }
  if (!value.trim()) {
    return {
      ok: false,
      error: 'Error: report_outcome "summary" must be non-empty. Retry with a one-line description of what happened.',
    };
  }
  return { ok: true, value };
}

/**
 * Builder schema: `{ outcome, summary, evidence[], blockers[], needs[] }`.
 *
 * Every field is required on every outcome so the agent cannot "forget"
 * `needs` on a blocked report and still look successful. Empty arrays are fine.
 *
 * @param {unknown} raw
 * @returns {import('./report-tool').ParseReportResult}
 */
export function parseBuilderReport(raw) {
  const obj = coerceObject(raw);
  if (!obj.ok) return obj;

  const outcome = obj.value.outcome;
  if (!BUILDER_OUTCOMES.has(outcome)) {
    return {
      ok: false,
      error: `Error: report_outcome requires outcome "pass", "fail", or "blocked". You sent ${JSON.stringify(outcome)}. "blocked" means the environment cannot support the work (missing dependency, unstartable service, absent credential) — not that the code is hard. Retry with a valid outcome.`,
    };
  }

  const summary = requireNonEmptySummary(obj.value.summary);
  if (!summary.ok) return summary;

  const evidence = requireStringArray(obj.value.evidence, 'evidence');
  if (!evidence.ok) return evidence;
  const blockers = requireStringArray(obj.value.blockers, 'blockers');
  if (!blockers.ok) return blockers;
  const needs = requireStringArray(obj.value.needs, 'needs');
  if (!needs.ok) return needs;

  if (outcome === 'pass') {
    return {
      ok: true,
      result: { outcome: 'pass', summary: summary.value, evidence: evidence.value },
    };
  }
  if (outcome === 'fail') {
    return {
      ok: true,
      result: { outcome: 'fail', summary: summary.value, blockers: blockers.value },
    };
  }
  return {
    ok: true,
    result: { outcome: 'blocked', summary: summary.value, needs: needs.value },
  };
}

/**
 * Tester schema: `{ outcome, summary, evidence[], testOutput }`.
 *
 * Tester has no `blocked`. An environment that cannot run tests is a Builder
 * `repair` problem; the Tester's job is to pass or fail the build in front of it.
 *
 * @param {unknown} raw
 * @returns {import('./report-tool').ParseReportResult}
 */
export function parseTesterReport(raw) {
  const obj = coerceObject(raw);
  if (!obj.ok) return obj;

  const outcome = obj.value.outcome;
  if (outcome === 'blocked') {
    return {
      ok: false,
      error:
        'Error: the tester may only report "pass" or "fail". "blocked" is a builder outcome for when the environment cannot support the work. Retry with pass or fail; if you could not run tests, report fail and put the missing-environment detail in testOutput.',
    };
  }
  if (!TESTER_OUTCOMES.has(outcome)) {
    return {
      ok: false,
      error: `Error: report_outcome requires outcome "pass" or "fail". You sent ${JSON.stringify(outcome)}. Retry with one of those two.`,
    };
  }

  const summary = requireNonEmptySummary(obj.value.summary);
  if (!summary.ok) return summary;

  const evidence = requireStringArray(obj.value.evidence, 'evidence');
  if (!evidence.ok) return evidence;

  if (typeof obj.value.testOutput !== 'string') {
    return {
      ok: false,
      error:
        'Error: report_outcome requires "testOutput" as a string (the command output, or "" if nothing ran). Retry and include testOutput.',
    };
  }

  if (outcome === 'pass') {
    return {
      ok: true,
      result: { outcome: 'pass', summary: summary.value, evidence: evidence.value },
    };
  }
  // TurnResult.fail carries `blockers`. The tester's `testOutput` is the
  // evidence a fix-seeded builder needs; surface it as the blocker list so
  // `runTurn` can return the PRD object union without a role-shaped field.
  const testOutput = obj.value.testOutput;
  const blockers = testOutput ? [testOutput, ...evidence.value] : evidence.value;
  return {
    ok: true,
    result: { outcome: 'fail', summary: summary.value, blockers },
  };
}

/**
 * @param {'builder' | 'tester'} role
 * @returns {(raw: unknown) => import('./report-tool').ParseReportResult}
 */
export function parseReportFor(role) {
  return role === 'tester' ? parseTesterReport : parseBuilderReport;
}

/**
 * OpenAI function-tool definition for the Builder.
 *
 * @returns {import('../runner/run-turn').TurnToolDefinition}
 */
export function builderReportTool() {
  return {
    type: 'function',
    function: {
      name: REPORT_TOOL_NAME,
      description:
        'Report the outcome of this attempt. Call once when finished. Do not put the outcome only in assistant text. A rejected call is not a finished report — fix the payload and retry. Use blocked only when the environment cannot support the work (missing dependency, unstartable service, absent credential), never because the code is hard.',
      parameters: {
        type: 'object',
        properties: {
          outcome: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
          summary: { type: 'string', description: 'What you changed and how you verified it, or why you stopped.' },
          evidence: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files, commands, or observations that support the outcome.',
          },
          blockers: {
            type: 'array',
            items: { type: 'string' },
            description: 'What specifically failed. Empty array on pass or blocked.',
          },
          needs: {
            type: 'array',
            items: { type: 'string' },
            description: 'What the environment is missing. Required (use [] when not blocked).',
          },
        },
        required: ['outcome', 'summary', 'evidence', 'blockers', 'needs'],
      },
    },
  };
}

/**
 * OpenAI function-tool definition for the Tester.
 *
 * @returns {import('../runner/run-turn').TurnToolDefinition}
 */
export function testerReportTool() {
  return {
    type: 'function',
    function: {
      name: REPORT_TOOL_NAME,
      description:
        'Report the test verdict for this attempt. Call once when finished. Do not put the outcome only in assistant text. A rejected call is not a finished report — fix the payload and retry. Outcome is pass or fail only.',
      parameters: {
        type: 'object',
        properties: {
          outcome: { type: 'string', enum: ['pass', 'fail'] },
          summary: { type: 'string', description: 'What you ran and what it showed.' },
          evidence: {
            type: 'array',
            items: { type: 'string' },
            description: 'Commands run and files inspected.',
          },
          testOutput: {
            type: 'string',
            description: 'The test command output the builder needs if this is a fail.',
          },
        },
        required: ['outcome', 'summary', 'evidence', 'testOutput'],
      },
    },
  };
}

/**
 * @param {'builder' | 'tester'} role
 * @returns {import('../runner/run-turn').TurnToolDefinition}
 */
export function reportToolFor(role) {
  return role === 'tester' ? testerReportTool() : builderReportTool();
}
