/**
 * P2-B — board-agnostic `runTurn()` (PRD §9 / MIN-699).
 *
 * Wraps the P2-A loop. Completions and tool dispatch stay injected so P2-C / P2-D
 * can swap adapters without touching this signature.
 *
 * **Any change to `runTurn({ chatId, seed, tools, model, onEvent, … })` is a
 * Phase 6 finding and must be recorded as one.** Phase 6 is "all chat eventually";
 * baking a domain concept into this entry point would force a rewrite.
 *
 * P6-A (MIN-723) did not edit this file. P6-B (MIN-724) adds `ask` on options
 * — the PRD §9 injected-capability finding. P6-C (MIN-725) adds history
 * continuation (`messages` / `seedKind: 'continue'`), optional report-tool
 * injection, and gates for the inner tool-use nudge + structured-outcome
 * finalization. There is still no board-vs-chat branch: the caller supplies
 * flags, not a product name.
 *
 * P6-D (MIN-726): `onLiveActivity.currentToolName` is forwarded as
 * `TurnEvent.tool_streaming`. The inner loop already parsed the name from SSE
 * (`onToolCallDelta`); this wrapper was dropping it. Chat paints
 * "Calling {tool}…" from that event — not a second stream parser. Boards that
 * omit `onEvent` are unchanged.
 *
 * P10-B (MIN-767): forward inner `phase` (was discarded), plus `onTurnEvent`
 * (`round_start` / `round_end` / `reasoning_end` / `stream_meta`). `tool_result`
 * moved onto `onToolDone` so parseError / abort fills still emit. There is
 * still no board-vs-chat branch.
 *
 * P10-C (MIN-768): continue turns persist on every settled `onMessagesChange`
 * via a monotonic `persistCursor`. `finally` is an idempotent backstop for
 * abort/throw. Isolated persist is unchanged. There is still no board-vs-chat
 * branch.
 *
 * P10-I (MIN-774): `onRoundBoundary` is consulted at each tool-loop boundary.
 * Return rows to splice, or null. Same injection shape as `ask` — chat
 * implements steer here; board / sub-agent callers omit the hook. There is
 * still no board-vs-chat branch.
 *
 * Outcomes: `pass` / `fail` / `blocked` come only from a successful report-tool
 * call. This file never imports the sub-agent prose JSON parser — if the tool
 * was not called, the answer is `no_report`, not a guess from assistant text.
 *
 * P2-E: a malformed report is rejected at execute-time (tool result = error
 * the model can act on) so the agent can retry inside the turn. That rejection
 * is not `no_report`.
 */

import { sumUsageSegments } from './stats-math.js';
import { createSubAgentRunner } from './sub-agent-runner.js';
import { buildOpeningTranscript } from './opening-messages.js';
import { STOPPED_TOOL_MSG } from './tool-batch.js';
import {
  ASK_QUESTION_TIMEOUT_ERROR,
  ASK_QUESTION_TOOL_NAME,
  ASK_QUESTION_UNAVAILABLE_ERROR,
  DEFAULT_ASK_TIMEOUT_MS,
  isAskCapability,
  parseAskQuestionArgs,
  resolveAskTimeoutMs,
  stringifyAskAnswer,
  withAskQuestionTool,
} from './ask-question-tool.js';

/** Default injected report tool. Generic on purpose — P2-E owns real schemas. */
export const DEFAULT_REPORT_TOOL_NAME = 'report_outcome';

export {
  ASK_QUESTION_TIMEOUT_ERROR,
  ASK_QUESTION_TOOL_NAME,
  ASK_QUESTION_UNAVAILABLE_ERROR,
  DEFAULT_ASK_TIMEOUT_MS,
};

const AGENT_OUTCOMES = new Set(['pass', 'fail', 'blocked']);

/** Distinguishes a captured report from a real failure when unwinding the loop. */
const TURN_REPORTED = Symbol('turn-reported');
/** Distinguishes maxTurns / wall-clock abort from a provider crash. */
const TURN_TIMEOUT = Symbol('turn-timeout');
/** Distinguishes the interactive-ask watchdog from composer Stop / wall-clock. */
const ASK_TIMEOUT = Symbol('ask-timeout');

/**
 * @param {unknown} value
 * @returns {string[] | null}
 */
function asStringArray(value) {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return value;
}

/**
 * Default report parser. Lenient on purpose: this package does not know
 * Builder vs Tester. Role-specific schemas are injected via `parseReport`
 * (P2-E) so a rejected call can name the missing field and the model can retry.
 *
 * A failed parse is **not** `no_report`. `no_report` means the tool was never
 * called successfully at all.
 *
 * @param {unknown} raw
 * @returns {import('./run-turn').ParseReportResult}
 */
function defaultParseReport(raw) {
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
        'Error: report_outcome requires a JSON object with "outcome" and "summary". Retry with an object, not an array or primitive.',
    };
  }
  const outcome = obj.outcome;
  if (!AGENT_OUTCOMES.has(outcome)) {
    return {
      ok: false,
      error: `Error: report_outcome requires outcome "pass", "fail", or "blocked". You sent ${JSON.stringify(outcome)}. Retry with one of those three.`,
    };
  }
  if (typeof obj.summary !== 'string') {
    return {
      ok: false,
      error: 'Error: report_outcome requires "summary" as a string. Retry and include summary.',
    };
  }
  if (outcome === 'pass') {
    const evidence = asStringArray(obj.evidence);
    if (!evidence) {
      return {
        ok: false,
        error:
          'Error: report_outcome outcome "pass" requires "evidence", an array of strings (use [] if there are none). Retry with evidence.',
      };
    }
    return { ok: true, result: { outcome: 'pass', summary: obj.summary, evidence } };
  }
  if (outcome === 'fail') {
    const blockers = asStringArray(obj.blockers);
    if (!blockers) {
      return {
        ok: false,
        error:
          'Error: report_outcome outcome "fail" requires "blockers", an array of strings. Retry with blockers.',
      };
    }
    return { ok: true, result: { outcome: 'fail', summary: obj.summary, blockers } };
  }
  const needs = asStringArray(obj.needs);
  if (!needs) {
    return {
      ok: false,
      error:
        'Error: report_outcome outcome "blocked" requires "needs", an array of strings naming what the environment is missing. Retry with needs.',
    };
  }
  return { ok: true, result: { outcome: 'blocked', summary: obj.summary, needs } };
}

/**
 * @param {unknown} toolCall
 * @returns {{ name: string, id?: string, arguments: unknown }}
 */
function inspectToolCall(toolCall) {
  const fn = toolCall && typeof toolCall === 'object' ? toolCall.function : null;
  const name = typeof fn?.name === 'string' ? fn.name : '';
  const id = typeof toolCall?.id === 'string' ? toolCall.id : undefined;
  return { name, id, arguments: fn?.arguments };
}

/**
 * Run an injected parser, or the default, without letting a throw become a
 * crashed turn. A parser bug should look like a rejected tool call so the
 * model can retry, not like a runner crash.
 *
 * @param {unknown} raw
 * @param {import('./run-turn').ParseReport | undefined} parseReport
 * @returns {import('./run-turn').ParseReportResult}
 */
function runParseReport(raw, parseReport) {
  if (typeof parseReport !== 'function') return defaultParseReport(raw);
  try {
    const out = parseReport(raw);
    if (out && out.ok === true && out.result && AGENT_OUTCOMES.has(out.result.outcome)) {
      return { ok: true, result: out.result };
    }
    if (out && out.ok === false && typeof out.error === 'string' && out.error) {
      return { ok: false, error: out.error };
    }
    return {
      ok: false,
      error:
        'Error: report_outcome rejected the payload. Retry with a valid object matching the tool schema.',
    };
  } catch (err) {
    return {
      ok: false,
      error: `Error: report_outcome could not parse the payload (${errorMessage(err)}). Retry with a valid JSON object.`,
    };
  }
}

/**
 * @param {string} name
 * @returns {import('./run-turn').TurnToolDefinition}
 */
function defaultReportTool(name) {
  return {
    type: 'function',
    function: {
      name,
      description:
        'Report the outcome of this turn. Call once when finished. Do not put the outcome only in assistant text.',
      parameters: {
        type: 'object',
        properties: {
          outcome: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
          summary: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          blockers: { type: 'array', items: { type: 'string' } },
          needs: { type: 'array', items: { type: 'string' } },
        },
        required: ['outcome', 'summary'],
      },
    },
  };
}

/**
 * Ensure the report tool is on the wire. Callers (P2-E) may pass a real schema
 * under the same name; we do not replace it.
 *
 * @param {import('./run-turn').TurnToolDefinition[] | undefined} tools
 * @param {string} reportToolName
 */
function withReportTool(tools, reportToolName) {
  const list = Array.isArray(tools) ? tools.slice() : [];
  if (list.some((tool) => tool?.function?.name === reportToolName)) return list;
  list.push(defaultReportTool(reportToolName));
  return list;
}

/**
 * Whether this caller wants a report tool on the wire. Default is inject-on
 * so board-shaped callers stay unchanged. `reportToolName: null` or
 * `injectReportTool: false` omits it. Injection is a caller flag, not a
 * product-shaped branch.
 *
 * @param {{ reportToolName?: string | null, injectReportTool?: boolean }} [options]
 * @returns {{ inject: boolean, reportToolName: string | null }}
 */
function resolveReportInjection(options = {}) {
  if (options.injectReportTool === false || options.reportToolName === null) {
    return { inject: false, reportToolName: null };
  }
  const reportToolName =
    typeof options.reportToolName === 'string' && options.reportToolName.trim()
      ? options.reportToolName.trim()
      : DEFAULT_REPORT_TOOL_NAME;
  return { inject: true, reportToolName };
}

/**
 * Resolve the tool list the model actually sees. `ask_question` is added or
 * stripped here from the capability, then the report tool is ensured unless
 * the caller opted out.
 *
 * @param {import('./run-turn').TurnToolDefinition[] | undefined} tools
 * @param {{ reportToolName?: string | null, injectReportTool?: boolean, ask?: unknown }} [options]
 * @returns {import('./run-turn').TurnToolDefinition[]}
 */
export function resolveTurnTools(tools, options = {}) {
  const withAsk = withAskQuestionTool(tools, options.ask);
  const injection = resolveReportInjection(options);
  if (!injection.inject || !injection.reportToolName) return withAsk;
  return withReportTool(withAsk, injection.reportToolName);
}

export { buildOpeningMessages, buildOpeningTranscript } from './opening-messages.js';

/**
 * @param {AbortSignal[]} signals
 * @returns {AbortSignal}
 */
function anySignal(signals) {
  const live = signals.filter(Boolean);
  if (live.length === 0) return new AbortController().signal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(live);
  const ctrl = new AbortController();
  for (const signal of live) {
    if (signal.aborted) {
      ctrl.abort(signal.reason);
      return ctrl.signal;
    }
    signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  return ctrl.signal;
}

function isAbortError(err) {
  return Boolean(err) && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
}

/**
 * Reject when `signal` aborts so a hanging `ask()` cannot stall the race.
 *
 * @param {AbortSignal} signal
 * @returns {Promise<never>}
 */
function waitForAbort(signal) {
  return new Promise((_, reject) => {
    const fail = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      err.cause = signal.reason;
      reject(err);
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
}

/**
 * Route `ask_question` through the injected capability (or fail immediately).
 * The unattended path never waits on `askTimeoutMs`.
 *
 * @param {unknown} rawArgs
 * @param {{
 *   ask: unknown,
 *   askTimeoutMs?: number,
 *   signal?: AbortSignal,
 *   turnTimeoutSignal?: AbortSignal,
 *   chatId: string,
 * }} opts
 * @returns {Promise<string>}
 */
async function runAskCapability(rawArgs, opts) {
  if (!isAskCapability(opts.ask)) {
    return ASK_QUESTION_UNAVAILABLE_ERROR;
  }
  const timeoutMs = resolveAskTimeoutMs(opts.askTimeoutMs);
  const askTimeoutCtrl = new AbortController();
  const timer = setTimeout(() => {
    askTimeoutCtrl.abort(ASK_TIMEOUT);
  }, timeoutMs);
  const combined = anySignal(
    [opts.signal, opts.turnTimeoutSignal, askTimeoutCtrl.signal].filter(Boolean),
  );
  try {
    const askPromise = Promise.resolve().then(() =>
      opts.ask.ask(parseAskQuestionArgs(rawArgs), {
        signal: combined,
        chatId: opts.chatId,
      }),
    );
    const abortPromise = waitForAbort(combined);
    try {
      const answer = await Promise.race([askPromise, abortPromise]);
      return stringifyAskAnswer(answer);
    } catch (err) {
      if (opts.turnTimeoutSignal?.aborted) {
        const timeoutErr = new Error('maxTurns or wallClockMs exceeded');
        timeoutErr[TURN_TIMEOUT] = true;
        throw timeoutErr;
      }
      if (opts.signal?.aborted) {
        throw isAbortError(err) ? err : Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      if (askTimeoutCtrl.signal.aborted) {
        return ASK_QUESTION_TIMEOUT_ERROR;
      }
      if (isAbortError(err)) throw err;
      return `Error: ask_question failed (${errorMessage(err)}).`;
    } finally {
      // The loser of the race must not become an unhandledRejection later.
      askPromise.catch(() => {});
      abortPromise.catch(() => {});
    }
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(err) {
  if (err instanceof Error && err.message) return err.message;
  return String(err ?? 'unknown error');
}

/**
 * Presentation callback failures must not change the turn outcome.
 * @param {((event: import('./run-turn').TurnEvent) => void) | undefined} onEvent
 * @param {import('./run-turn').TurnEvent} event
 */
function emit(onEvent, event) {
  if (typeof onEvent !== 'function') return;
  try {
    onEvent(event);
  } catch {
    // Swallow: onEvent is a view seam, not part of the result contract.
  }
}

/**
 * Build a `tool_result` from a batch outcome. parseError and abort fills never
 * call `execute`, so this is the only place those rows can be emitted.
 *
 * @param {unknown} outcome
 * @returns {import('./run-turn').TurnEvent | null}
 */
function toolResultEventFromOutcome(outcome) {
  const tc = outcome && typeof outcome === 'object' ? outcome.toolCall : null;
  const fn = tc && typeof tc === 'object' ? tc.function : null;
  const name = typeof fn?.name === 'string' ? fn.name : '';
  if (!name) return null;
  const id = typeof tc?.id === 'string' ? tc.id : undefined;
  if (typeof outcome.parseError === 'string' && outcome.parseError) {
    return {
      type: 'tool_result',
      name,
      ...(id ? { id } : {}),
      content: outcome.parseError,
      isError: true,
    };
  }
  const result = outcome.result && typeof outcome.result === 'object' ? outcome.result : {};
  const content = typeof result.content === 'string' ? result.content : '';
  /** @type {import('./run-turn').TurnEvent} */
  const event = { type: 'tool_result', name, content };
  if (id) event.id = id;
  if (Array.isArray(result.attachments) && result.attachments.length > 0) {
    event.attachments = result.attachments;
  }
  if (result.codeChange !== undefined) event.codeChange = result.codeChange;
  if (result.isError === true || content === STOPPED_TOOL_MSG) event.isError = true;
  return event;
}

/**
 * Keep only well-formed transcript rows from a round-boundary hook.
 * Product flags like `steer` stay on the caller's persisted history; the
 * wire transcript is role + content (+ tool ids) so providers do not see
 * unknown fields.
 *
 * @param {unknown} raw
 * @returns {import('./transcript-store').TranscriptMessage[]}
 */
function normalizeRoundBoundaryRows(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  /** @type {import('./transcript-store').TranscriptMessage[]} */
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || typeof row.role !== 'string') continue;
    /** @type {import('./transcript-store').TranscriptMessage} */
    const next = { role: row.role };
    if ('content' in row) next.content = row.content;
    if (typeof row.tool_call_id === 'string') next.tool_call_id = row.tool_call_id;
    if (Array.isArray(row.tool_calls)) next.tool_calls = row.tool_calls;
    out.push(next);
  }
  return out;
}

/**
 * Persist only the new tail. The inner loop owns the in-memory transcript;
 * this store is the durable seam for callers (and P2-F).
 *
 * Isolated turns persist every inner row (including the leading system) and
 * re-derive the anchor from the store each time, so appending is self-aligning.
 *
 * Continue turns pass `from` — first `buildOpeningTranscript().persistFrom`,
 * then a monotonic `persistCursor` advanced after each settled snapshot. That
 * is the only honest anchor: the opening is not `store.load().messages.length + 1`
 * whenever the fold collapses a leading assistant greeting into the system row
 * (expert chats), nor when the opening appends a seed row the store lacks.
 * Deriving it from `have` drops this turn's first rows in the first case and
 * skips the seed row in the second. Re-running with the same `from` after the
 * cursor has caught up is a no-op (`messages.length <= aligned`).
 *
 * @param {import('./transcript-store').TranscriptStore} store
 * @param {string} chatId
 * @param {unknown[]} messages
 * @param {{ from?: number }} [opts]
 */
function persistNewMessages(store, chatId, messages, opts = {}) {
  if (!store || typeof store.append !== 'function') return;
  if (!Array.isArray(messages)) return;
  const aligned =
    typeof opts.from === 'number' ? opts.from : (store.load(chatId)?.messages?.length ?? 0);
  if (messages.length <= aligned) return;
  for (let i = aligned; i < messages.length; i += 1) {
    store.append(chatId, messages[i]);
  }
}

/**
 * Board-agnostic turn entry (PRD §9).
 *
 * @param {import('./run-turn').RunTurnOptions} options
 * @returns {Promise<import('./run-turn').TurnResult>}
 */
export async function runTurn(options) {
  if (!options || typeof options !== 'object') {
    return { outcome: 'crashed', error: 'runTurn: options object is required' };
  }
  const chatId = String(options.chatId ?? '');
  if (!chatId) {
    return { outcome: 'crashed', error: 'runTurn: chatId is required' };
  }
  const deps = options.deps;
  if (!deps) {
    return { outcome: 'crashed', error: 'runTurn: deps are required' };
  }
  const model = options.model;
  if (!model?.providerId || !model?.id) {
    return { outcome: 'crashed', error: 'runTurn: model.providerId and model.id are required' };
  }

  const injection = resolveReportInjection(options);
  const reportToolName = injection.reportToolName;
  // P6-B: capability injection, not list-presence, decides ask_question.
  // P6-C: report-tool injection is optional (chat omits; board default stays on).
  const tools = resolveTurnTools(options.tools, {
    reportToolName: options.reportToolName,
    injectReportTool: options.injectReportTool,
    ask: options.ask,
  });
  const seed = typeof options.seed === 'string' ? options.seed : '';
  const limits = options.limits ?? {};
  const transcript = options.transcript ?? deps.transcriptStore;
  const onEvent = options.onEvent;
  const cwd = options.cwd;
  // Continue vs isolated: explicit `messages` wins; `seedKind: 'continue'`
  // loads the store. Board callers that pass only `seed` stay isolated.
  /** @type {unknown[] | undefined} */
  let priorMessages;
  if (Array.isArray(options.messages)) {
    priorMessages = options.messages;
  } else if (options.seedKind === 'continue') {
    priorMessages = transcript.load(chatId)?.messages ?? [];
  }
  // Continue turns suffix an existing product transcript; isolated turns own theirs.
  const isContinueTurn = priorMessages !== undefined;
  // Phase 6 finding: optional `systemPrompt` so a caller can inject Builder /
  // Tester instructions without the runner knowing what a role is. Default
  // stays domain-free. When the report tool is omitted, do not tell the model
  // to call it. Recorded in orchestrator-v2-implementation.md.
  const systemPrompt =
    typeof options.systemPrompt === 'string' && options.systemPrompt.trim()
      ? options.systemPrompt
      : injection.inject
        ? 'When you have a result, call the report tool. Do not put the outcome only in assistant text.'
        : 'You are a helpful assistant.';

  // Continue-mode persist anchor. `buildOpeningTranscript` is pure and the
  // inner runner opens with exactly these arguments (`task: seed`,
  // `systemPrompt`, `priorMessages`), so recomputing it here yields the same
  // boundary the loop started from. It beats `have + 1`, which the fold (rows
  // removed) and the appended seed row (a row added) both invalidate.
  // P10-C: this is the start of a monotonic cursor, not a once-at-end index.
  const continuePersistFrom =
    priorMessages === undefined
      ? 0
      : buildOpeningTranscript(systemPrompt, seed, priorMessages).persistFrom;
  let persistCursor = continuePersistFrom;

  /** @type {import('./run-turn').TurnResult | null} */
  let captured = null;
  let completionCount = 0;
  const timeoutCtrl = new AbortController();
  let wallTimer = null;
  if (typeof limits.wallClockMs === 'number' && limits.wallClockMs > 0) {
    wallTimer = setTimeout(() => {
      timeoutCtrl.abort(TURN_TIMEOUT);
    }, limits.wallClockMs);
  }

  const combinedSignal = anySignal(
    [options.signal, timeoutCtrl.signal].filter(Boolean),
  );

  /**
   * Count each provider call so `maxTurns` is a real cap, including the inner
   * loop's structured-outcome finalization (which this wrapper otherwise ignores).
   */
  const countedPost = async (provider, body, signal, postOptions) => {
    if (typeof limits.maxTurns === 'number' && completionCount >= limits.maxTurns) {
      timeoutCtrl.abort(TURN_TIMEOUT);
      const err = new Error('maxTurns exceeded');
      err[TURN_TIMEOUT] = true;
      throw err;
    }
    completionCount += 1;
    return deps.postChatCompletions(provider, body, signal, postOptions);
  };

  const interceptingBatch = async (batchOptions) => {
    const toolCalls = batchOptions?.toolCalls ?? [];
    for (const toolCall of toolCalls) {
      const inspected = inspectToolCall(toolCall);
      if (!inspected.name) continue;
      emit(onEvent, {
        type: 'tool_call',
        name: inspected.name,
        id: inspected.id,
        arguments: inspected.arguments,
      });
    }

    // Report + ask_question are owned here, not forwarded to `execute`.
    // Both are renderer-only ("Not implemented" on the server). A fabricated
    // ask_question with no capability must error immediately — never hang on
    // in-process dispatch or a missing modal.
    /** @type {Array<{ toolCall: unknown, result: { content: string } }>} */
    const outcomes = [];
    /** @type {unknown[]} */
    const otherCalls = [];
    for (const toolCall of toolCalls) {
      const inspected = inspectToolCall(toolCall);
      if (inspected.name === ASK_QUESTION_TOOL_NAME) {
        const content = await runAskCapability(inspected.arguments, {
          ask: options.ask,
          askTimeoutMs: options.askTimeoutMs,
          signal: options.signal,
          turnTimeoutSignal: timeoutCtrl.signal,
          chatId,
        });
        emit(onEvent, {
          type: 'tool_result',
          name: ASK_QUESTION_TOOL_NAME,
          id: inspected.id,
          content,
          ...(content.startsWith('Error:') ? { isError: true } : {}),
        });
        outcomes.push({ toolCall, result: { content } });
        continue;
      }
      if (inspected.name !== reportToolName) {
        otherCalls.push(toolCall);
        continue;
      }
      const parsed = runParseReport(inspected.arguments, options.parseReport);
      if (parsed.ok) {
        captured = parsed.result;
        const content = 'Outcome recorded.';
        emit(onEvent, {
          type: 'tool_result',
          name: reportToolName,
          id: inspected.id,
          content,
        });
        outcomes.push({ toolCall, result: { content } });
      } else {
        // Reject at execute-time so the agent can retry *inside* this turn.
        // This is not `no_report` — the tool was called, the payload was wrong.
        emit(onEvent, {
          type: 'tool_result',
          name: reportToolName,
          id: inspected.id,
          content: parsed.error,
          isError: true,
        });
        outcomes.push({ toolCall, result: { content: parsed.error } });
      }
    }

    // A valid report ends the turn immediately so the inner loop cannot fall
    // through to prose-JSON finalization and rewrite the outcome.
    if (captured) {
      const err = new Error('turn reported');
      err[TURN_REPORTED] = captured;
      throw err;
    }

    if (otherCalls.length === 0) return outcomes;

    // Execute no longer emits: parseError and abort fills never reach execute.
    // `onToolDone` fires once per call (execute-tool-batch invariant). Stubs
    // that skip the hook still emit from the returned outcomes, de-duplicated.
    const execute = async (name, args, ctx) => {
      if (typeof options.execute === 'function') {
        return options.execute(name, args, {
          toolCallId: ctx.toolCallId,
          chatId,
          cwd,
        });
      }
      return { content: '' };
    };

    const seenToolResultIds = new Set();
    const emitOutcome = (outcome) => {
      const event = toolResultEventFromOutcome(outcome);
      if (!event) return;
      const id = event.id;
      if (id) {
        if (seenToolResultIds.has(id)) return;
        seenToolResultIds.add(id);
      }
      emit(onEvent, event);
    };

    const rest = await deps.runHeadlessToolBatch({
      ...batchOptions,
      toolCalls: otherCalls,
      execute,
      onToolDone: (outcome) => {
        emitOutcome(outcome);
        if (typeof batchOptions.onToolDone === 'function') batchOptions.onToolDone(outcome);
      },
    });
    if (Array.isArray(rest)) {
      for (const outcome of rest) emitOutcome(outcome);
      outcomes.push(...rest);
    }
    return outcomes;
  };

  const wrappedDeps = {
    ...deps,
    transcriptStore: transcript,
    postChatCompletions: countedPost,
    runHeadlessToolBatch: interceptingBatch,
    resolveSamplerPreset: (input) =>
      model.sampler ?? deps.resolveSamplerPreset(input),
    resolveThinkingMode: (input) =>
      model.thinking?.mode
        ? { mode: model.thinking.mode }
        : deps.resolveThinkingMode(input),
    resolveThinkingBudgetTokens: (input) =>
      model.thinking && 'budgetTokens' in model.thinking
        ? { budgetTokens: model.thinking.budgetTokens ?? null }
        : deps.resolveThinkingBudgetTokens(input),
  };

  if (transcript && model.thinking?.mode) {
    transcript.setMeta(chatId, { thinkingMode: model.thinking.mode });
  }

  let lastDelta = '';
  let lastThinking = '';
  let lastStreamingTool = '';
  /** @type {string | null} */
  let lastPhase = null;
  /** Last settled onMessagesChange snapshot — continue persist suffixes from it. */
  let lastSnapshot = null;

  const runner = createSubAgentRunner(wrappedDeps);

  /**
   * Token usage for this turn: every completion the inner runner made,
   * including the tool loop and any finalization.
   *
   * Collected through `onUsage` rather than from `runner.run()`'s return,
   * because the return is the path this wrapper takes least. A successful
   * attempt ends when `report_outcome` throws to unwind the loop, and a
   * timed-out or aborted one throws too — in all three cases the runner's own
   * total never comes back. Segments as they land is the only accounting that
   * survives every exit.
   *
   * Without this there is no answer to "what did the run cost", which P5-D must
   * report and which is the only way to weigh a correctness gain against price.
   *
   * @type {Array<Record<string, number>>}
   */
  const usageSegments = [];
  /** @type {Record<string, number> | undefined} */
  let usage;

  /**
   * Attach the turn's usage to whatever outcome the turn produced. Every return
   * path goes through here so a crashed or timed-out attempt still reports the
   * tokens it burned — those are exactly the attempts worth costing.
   *
   * @param {import('./run-turn').TurnResult} result
   * @returns {import('./run-turn').TurnResult}
   */
  const withUsage = (result) => {
    if (!usage && usageSegments.length > 0) usage = sumUsageSegments(usageSegments);
    return usage ? { ...result, usage } : result;
  };

  try {
    const ran = await runner.run({
      runId: chatId,
      type: 'turn',
      task: seed,
      systemPrompt,
      tools,
      providerId: model.providerId,
      modelId: model.id,
      parentChatId: chatId,
      contextBudget: limits.contextBudget,
      modelContextLimit: limits.modelContextLimit,
      signal: combinedSignal,
      toolExecuteContext: { chatId, cwd },
      // P6-C: prior transcript + nudge/finalization gates. Omitted = isolated
      // start with today's sub-agent nudge and structured-outcome pass.
      priorMessages,
      nudgeToolUse: options.nudgeToolUse,
      finalizeStructuredOutcome: options.finalizeStructuredOutcome,
      summarySchema: options.summarySchema,
      executeTool: async (name, args, ctx) => {
        if (typeof options.execute === 'function') {
          return options.execute(name, args, {
            toolCallId: ctx?.toolCallId,
            chatId,
            cwd,
          });
        }
        return { content: '' };
      },
      onMessagesChange: (messages, meta) => {
        // Isolated turns persist live (board default), including throttled
        // clones — leave that path exactly as it is.
        if (!isContinueTurn) {
          persistNewMessages(transcript, chatId, messages);
        } else if (meta?.settled === true && Array.isArray(messages)) {
          // Continue: persist only settled snapshots (real messages.push).
          // persistCursor makes a later finally-pass a no-op when nothing new
          // landed. Unsettled clones carry a synthetic partial assistant and
          // must not be appended (P10-E owns stopped/failed presentation).
          persistNewMessages(transcript, chatId, messages, { from: persistCursor });
          persistCursor = messages.length;
          lastSnapshot = messages;
        }
        if (!Array.isArray(messages) || messages.length === 0) return;
        const last = messages[messages.length - 1];
        if (last?.role !== 'assistant') return;
        const text = typeof last.content === 'string' ? last.content : '';
        if (!text || text === lastDelta) return;
        lastDelta = text;
        emit(onEvent, { type: 'delta', text });
      },
      onTurnEvent: (event) => {
        emit(onEvent, event);
      },
      // P10-I: injected like AskCapability. Chat's consumePendingSteer already
      // wrote the product row; continue persist must not suffix it again.
      onRoundBoundary:
        typeof options.onRoundBoundary === 'function'
          ? () => {
              try {
                const spliced = normalizeRoundBoundaryRows(options.onRoundBoundary());
                if (spliced.length === 0) return null;
                if (isContinueTurn) persistCursor += spliced.length;
                return spliced;
              } catch {
                // Caller seam — a throw must not crash the turn.
                return null;
              }
            }
          : undefined,
      onUsage: (segment) => {
        if (segment && typeof segment === 'object') usageSegments.push(segment);
      },
      onLiveActivity: (activity) => {
        const phase = activity?.phase;
        if (
          (phase === 'generating' || phase === 'thinking' || phase === 'tools') &&
          phase !== lastPhase
        ) {
          lastPhase = phase;
          emit(onEvent, { type: 'phase', phase });
        }
        const thinking = activity?.partialReasoning;
        if (typeof thinking === 'string' && thinking && thinking !== lastThinking) {
          lastThinking = thinking;
          emit(onEvent, { type: 'thinking', text: thinking });
        }
        // Inner `onToolCallDelta` already named the tool; chat paints the
        // "Calling {tool}…" indicator from this event (P6-D overlay).
        const toolName =
          typeof activity?.currentToolName === 'string'
            ? activity.currentToolName.trim()
            : '';
        if (toolName && toolName !== lastStreamingTool) {
          lastStreamingTool = toolName;
          emit(onEvent, { type: 'tool_streaming', name: toolName });
        }
      },
    });
    // Prefer the runner's own sum when the turn returned normally; the
    // segments are the fallback for every path that throws.
    if (ran?.usage) usage = ran.usage;
  } catch (err) {
    if (captured) return withUsage(captured);
    if (err?.[TURN_REPORTED]) return withUsage(err[TURN_REPORTED]);
    if (err?.[TURN_TIMEOUT] || timeoutCtrl.signal.aborted) {
      return withUsage({ outcome: 'timeout' });
    }
    if (options.signal?.aborted && isAbortError(err)) {
      return withUsage({ outcome: 'crashed', error: 'aborted' });
    }
    return withUsage({ outcome: 'crashed', error: errorMessage(err) });
  } finally {
    if (isContinueTurn && lastSnapshot) {
      // Idempotent backstop for abort/throw: persistCursor already sits at
      // last settled length after incremental persist, so this appends nothing.
      persistNewMessages(transcript, chatId, lastSnapshot, {
        from: persistCursor,
      });
    }
    if (wallTimer) clearTimeout(wallTimer);
  }

  if (captured) return withUsage(captured);
  if (timeoutCtrl.signal.aborted) return withUsage({ outcome: 'timeout' });
  // Inner loop may have parsed assistant JSON. That path is a different product
  // (normal sub-agents). This wrapper does not read it.
  return withUsage({ outcome: 'no_report' });
}
