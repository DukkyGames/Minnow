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
 * Outcomes: `pass` / `fail` / `blocked` come only from a successful report-tool
 * call. This file never imports the sub-agent prose JSON parser — if the tool
 * was not called, the answer is `no_report`, not a guess from assistant text.
 *
 * P2-E: a malformed report is rejected at execute-time (tool result = error
 * the model can act on) so the agent can retry inside the turn. That rejection
 * is not `no_report`.
 */

import { createSubAgentRunner } from './sub-agent-runner.js';

/** Default injected report tool. Generic on purpose — P2-E owns real schemas. */
export const DEFAULT_REPORT_TOOL_NAME = 'report_outcome';

const AGENT_OUTCOMES = new Set(['pass', 'fail', 'blocked']);

/** Distinguishes a captured report from a real failure when unwinding the loop. */
const TURN_REPORTED = Symbol('turn-reported');
/** Distinguishes maxTurns / wall-clock abort from a provider crash. */
const TURN_TIMEOUT = Symbol('turn-timeout');

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
 * Persist only the new tail. The inner loop owns the in-memory transcript;
 * this store is the durable seam for callers (and P2-F).
 *
 * @param {import('./transcript-store').TranscriptStore} store
 * @param {string} chatId
 * @param {unknown[]} messages
 */
function persistNewMessages(store, chatId, messages) {
  if (!store || typeof store.append !== 'function') return;
  const have = store.load(chatId)?.messages?.length ?? 0;
  if (!Array.isArray(messages) || messages.length <= have) return;
  for (let i = have; i < messages.length; i += 1) {
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

  const reportToolName =
    typeof options.reportToolName === 'string' && options.reportToolName.trim()
      ? options.reportToolName.trim()
      : DEFAULT_REPORT_TOOL_NAME;
  const tools = withReportTool(options.tools, reportToolName);
  const seed = typeof options.seed === 'string' ? options.seed : '';
  const limits = options.limits ?? {};
  const transcript = options.transcript ?? deps.transcriptStore;
  const onEvent = options.onEvent;
  const cwd = options.cwd;
  // Phase 6 finding: optional `systemPrompt` so a caller can inject Builder /
  // Tester instructions without the runner knowing what a role is. Default
  // stays domain-free. Recorded in orchestrator-v2-implementation.md.
  const systemPrompt =
    typeof options.systemPrompt === 'string' && options.systemPrompt.trim()
      ? options.systemPrompt
      : 'When you have a result, call the report tool. Do not put the outcome only in assistant text.';

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

    // Report tool is owned here, not forwarded to `execute`. `report_outcome`
    // is not a server tool; sending it through in-process dispatch would
    // surface "unknown tool" instead of a schema error the model can fix.
    /** @type {Array<{ toolCall: unknown, result: { content: string } }>} */
    const outcomes = [];
    /** @type {unknown[]} */
    const otherCalls = [];
    for (const toolCall of toolCalls) {
      const inspected = inspectToolCall(toolCall);
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

    const execute = async (name, args, ctx) => {
      const result = options.execute
        ? await options.execute(name, args, {
            toolCallId: ctx.toolCallId,
            chatId,
            cwd,
          })
        : { content: '' };
      emit(onEvent, {
        type: 'tool_result',
        name,
        id: ctx.toolCallId,
        content: typeof result?.content === 'string' ? result.content : '',
      });
      return result;
    };

    const rest = await deps.runHeadlessToolBatch({
      ...batchOptions,
      toolCalls: otherCalls,
      execute,
    });
    if (Array.isArray(rest)) outcomes.push(...rest);
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

  const runner = createSubAgentRunner(wrappedDeps);

  try {
    await runner.run({
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
      onMessagesChange: (messages) => {
        persistNewMessages(transcript, chatId, messages);
        if (!Array.isArray(messages) || messages.length === 0) return;
        const last = messages[messages.length - 1];
        if (last?.role !== 'assistant') return;
        const text = typeof last.content === 'string' ? last.content : '';
        if (!text || text === lastDelta) return;
        lastDelta = text;
        emit(onEvent, { type: 'delta', text });
      },
      onLiveActivity: (activity) => {
        const thinking = activity?.partialReasoning;
        if (typeof thinking === 'string' && thinking && thinking !== lastThinking) {
          lastThinking = thinking;
          emit(onEvent, { type: 'thinking', text: thinking });
        }
      },
    });
  } catch (err) {
    if (captured) return captured;
    if (err?.[TURN_REPORTED]) return err[TURN_REPORTED];
    if (err?.[TURN_TIMEOUT] || timeoutCtrl.signal.aborted) {
      return { outcome: 'timeout' };
    }
    if (options.signal?.aborted && isAbortError(err)) {
      return { outcome: 'crashed', error: 'aborted' };
    }
    return { outcome: 'crashed', error: errorMessage(err) };
  } finally {
    if (wallTimer) clearTimeout(wallTimer);
  }

  if (captured) return captured;
  if (timeoutCtrl.signal.aborted) return { outcome: 'timeout' };
  // Inner loop may have parsed assistant JSON. That path is a different product
  // (normal sub-agents). This wrapper does not read it.
  return { outcome: 'no_report' };
}
