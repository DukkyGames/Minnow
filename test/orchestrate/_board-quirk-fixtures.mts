/**
 * Shared SSE chunks + FakeApiScript builders for headless board E2E and fake-model scenarios.
 */

import type { FakeApiScript, FakeApiTurn } from './_fake-api-router.mts';

/** Default duplicate-tool threshold from self-healing tier1 (sub-agents.json). */
export const DUPLICATE_TOOL_CALL_THRESHOLD = 5;

export function proseSse(text: string): string[] {
  const delta = JSON.stringify({
    choices: [{ delta: { content: text } }],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
  });
  return [
    `data: ${delta}\n\n`,
    `data: ${finish}\n\n`,
    `event: end\ndata: {"status":"complete"}\n\n`,
  ];
}

export function toolCallsSse(
  toolName: string,
  argsJson: string,
  toolCallId = 'call_headless_fixture',
): string[] {
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: 'function',
              function: { name: toolName, arguments: argsJson },
            },
          ],
        },
      },
    ],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
  });
  return [
    `data: ${delta}\n\n`,
    `data: ${finish}\n\n`,
    `event: end\ndata: {"status":"complete"}\n\n`,
  ];
}

export function boardReportSse(
  taskId: string,
  outcome: string,
  summary: string,
  toolCallId = 'call_board_report',
): string[] {
  const args = JSON.stringify({ task_id: taskId, outcome, summary });
  return toolCallsSse('board_report', args, toolCallId);
}

export function boardReportPassSse(taskId: string): string[] {
  return boardReportSse(taskId, 'pass', `Build verified for ${taskId}`);
}

export function testerVerdictSse(verdict: 'pass' | 'fail'): string[] {
  return proseSse(`VERDICT: ${verdict}`);
}

export function finalBoardReportSse(verdict: 'pass' | 'fail'): string[] {
  return boardReportSse('FULL_BOARD', verdict, `Final integration ${verdict}`);
}

/** Minimal prose ack after a tool-call round so runChatTurn can finish cleanly. */
export function postToolAckSse(): string[] {
  return proseSse('Done.');
}

/** Append a post-tool prose ack after scripted tool-call generations. */
export function appendPostToolAck(turns: FakeApiTurn[]): FakeApiTurn[] {
  return [...turns, { sse: postToolAckSse() }];
}

/** Representative provider copy when the model context window is exceeded. */
export const CONTEXT_EXCEEDED_MESSAGES = {
  lmStudio:
    'Trying to generate tokens after context limit has been reached (n_ctx = 4096)',
  openAi:
    "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.",
  generic: 'context length exceeded',
  llamaCpp: 'Requested tokens (8192) exceed context window of 4096',
  couldNotComplete: 'Could not complete this reply: context length exceeded',
} as const;

/** Terminal generation SSE with status error (Minnow /api/generations stream end). */
export function generationErrorEndSse(errorMessage: string): string[] {
  const payload = JSON.stringify({ status: 'error', errorMessage });
  return [`event: end\ndata: ${payload}\n\n`];
}

/** HTTP error on POST /api/generations before any stream opens (upstream 400/413). */
export function generationPostErrorTurn(
  status: number,
  body: string,
): FakeApiTurn {
  return { postError: { status, body } };
}

function toolTurns(sse: string[]): FakeApiScript['slots'][string] {
  return appendPostToolAck([{ sse }]);
}

/** Malformed tool arguments JSON — finalizeToolCalls should tolerate / error path. */
export function malformedToolArgsSse(taskId: string): string[] {
  const brokenArgs = '{"task_id":"' + taskId + '","outcome":"pass","summary":';
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_malformed',
              type: 'function',
              function: { name: 'board_report', arguments: brokenArgs },
            },
          ],
        },
      },
    ],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
  });
  return [`data: ${delta}\n\n`, `data: ${finish}\n\n`, `event: end\ndata: {"status":"complete"}\n\n`];
}

/** board_report with tolerant "green" outcome synonym (maps to pass). */
export function boardReportGreenSse(taskId: string): string[] {
  return boardReportSse(taskId, 'green', `Green tolerant path for ${taskId}`);
}

/** board_report with invalid outcome literal — validation fails client-side. */
export function boardReportBadOutcomeSse(taskId: string): string[] {
  return boardReportSse(taskId, 'purple', 'bad outcome should not validate');
}

/** board_report with empty summary — validation fails client-side. */
export function boardReportBlankSummarySse(taskId: string): string[] {
  return boardReportSse(taskId, 'pass', '   ');
}

/** Stream ends mid tool-call delta without finish_reason — truncated stream. */
export function truncatedMidToolCallSse(taskId: string): string[] {
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_truncated',
              type: 'function',
              function: {
                name: 'board_report',
                arguments: `{"task_id":"${taskId}","outcome":"pass","summary":"trunc`,
              },
            },
          ],
        },
      },
    ],
  });
  return [`data: ${delta}\n\n`, `event: end\ndata: {"status":"complete"}\n\n`];
}

/** Model requests a tool that is not in the enabled catalog. */
export function nonexistentToolSse(): string[] {
  return toolCallsSse('not_a_real_minnow_tool', '{}', 'call_fake_tool');
}

/** Repeated identical harmless tool calls — exercises multi-round tool loop. */
export function runawayRepetitionTurns(count: number): string[][] {
  const turns: string[][] = [];
  for (let i = 0; i < count; i++) {
    turns.push(toolCallsSse('get_datetime', '{}', `call_repeat_${i}`));
  }
  return turns;
}

function slotTurns(sse: string[]): FakeApiScript['slots'][string] {
  return [{ sse }];
}

/** Multi-wave happy path: W1-A, W1-B, W2-A + final integration test. */
export function multiWaveHappyScript(): FakeApiScript {
  const slots: FakeApiScript['slots'] = {};
  for (const taskId of ['W1-A', 'W1-B', 'W2-A']) {
    slots[`${taskId}:build`] = toolTurns(boardReportPassSse(taskId));
    slots[`${taskId}:test`] = slotTurns(testerVerdictSse('pass'));
  }
  slots.final = toolTurns(finalBoardReportSse('pass'));
  return {
    slots,
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  };
}

/** Tester prose without VERDICT — board nudges up to MISSING_REPORT_NUDGE_CAP (2). */
export function testerProseNoVerdictScript(taskId: string): FakeApiScript {
  const prose = 'All checks looked fine but I forgot the marker.';
  return {
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportPassSse(taskId)),
      [`${taskId}:test`]: [
        { sse: proseSse(prose) },
        { sse: proseSse(prose) },
        { sse: testerVerdictSse('pass') },
      ],
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  };
}

/** Runaway get_datetime repetition then successful board_report. */
export function runawayRepetitionScript(taskId: string): FakeApiScript {
  const repetitions = DUPLICATE_TOOL_CALL_THRESHOLD + 1;
  const buildTurns = runawayRepetitionTurns(repetitions).map((sse) => ({ sse }));
  buildTurns.push({ sse: boardReportPassSse(taskId) });
  return {
    slots: {
      [`${taskId}:build`]: appendPostToolAck(buildTurns),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  };
}

/** Builder prose success without board_report — contract text from build.full.md. */
export function builderProseReadySse(): string[] {
  return proseSse('Implementation complete.\n\nStatus: READY FOR VERIFICATION');
}

/** board_report with tolerant outcome synonyms beyond green. */
export function boardReportOkSse(taskId: string): string[] {
  return boardReportSse(taskId, 'ok', `OK synonym for ${taskId}`);
}

export function boardReportSuccessSse(taskId: string): string[] {
  return boardReportSse(taskId, 'success', `Success synonym for ${taskId}`);
}

export function boardReportEnvBlockedSse(taskId: string): string[] {
  return boardReportSse(taskId, 'env_blocked', 'Postgres not running on port 5432');
}

export function boardReportFailSse(taskId: string): string[] {
  return boardReportSse(taskId, 'fail', 'Build could not verify changes');
}

/** Partially valid JSON args with trailing junk and unicode escapes. */
export function partialValidToolArgsSse(taskId: string): string[] {
  const args =
    `{"task_id":"${taskId}","outcome":"pass","summary":"ok"} trailing junk \\u0022`;
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_partial',
              type: 'function',
              function: { name: 'board_report', arguments: args },
            },
          ],
        },
      },
    ],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
  });
  return [`data: ${delta}\n\n`, `data: ${finish}\n\n`, `event: end\ndata: {"status":"complete"}\n\n`];
}

/** Truncated stream after tool name but before any arguments JSON. */
export function truncatedAfterToolNameSse(): string[] {
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_trunc_name',
              type: 'function',
              function: { name: 'board_report', arguments: '' },
            },
          ],
        },
      },
    ],
  });
  return [`data: ${delta}\n\n`, `event: end\ndata: {"status":"complete"}\n\n`];
}

/** Builder requests a board-stripped orchestrator tool (role-forbidden). */
export function forbiddenDelegateToolSse(): string[] {
  return toolCallsSse(
    'delegate_tasks',
    '{"tasks":[{"id":"W1-B","title":"Sibling"}]}',
    'call_forbidden_delegate',
  );
}

/** board_report plus a harmless tool call in the same delta. */
export function multipleToolCallsInDeltaSse(taskId: string): string[] {
  const reportArgs = JSON.stringify({
    task_id: taskId,
    outcome: 'pass',
    summary: `Multi-tool delta for ${taskId}`,
  });
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_noise',
              type: 'function',
              function: { name: 'get_datetime', arguments: '{}' },
            },
            {
              index: 1,
              id: 'call_report',
              type: 'function',
              function: { name: 'board_report', arguments: reportArgs },
            },
          ],
        },
      },
    ],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
  });
  return [`data: ${delta}\n\n`, `data: ${finish}\n\n`, `event: end\ndata: {"status":"complete"}\n\n`];
}

/** Tool-call delta but finish_reason stop — provider quirk. */
export function wrongFinishReasonSse(taskId: string): string[] {
  const args = JSON.stringify({ task_id: taskId, outcome: 'pass', summary: 'wrong finish' });
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_wrong_finish',
              type: 'function',
              function: { name: 'board_report', arguments: args },
            },
          ],
        },
      },
    ],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
  });
  return [`data: ${delta}\n\n`, `data: ${finish}\n\n`, `event: end\ndata: {"status":"complete"}\n\n`];
}

/** Repeated save_file calls before a successful board_report. */
export function runawaySaveFileTurns(count: number): string[][] {
  const turns: string[][] = [];
  for (let i = 0; i < count; i++) {
    turns.push(
      toolCallsSse(
        'save_file',
        JSON.stringify({ path: `scratch-${i}.txt`, content: 'noop' }),
        `call_save_${i}`,
      ),
    );
  }
  return turns;
}

/** Stall transcript from max tool turns — inferStreamOutcome should read failed. */
export function maxToolTurnsProseSse(): string[] {
  return proseSse('Maximum tool turns reached. Cannot complete this reply.');
}

/** Empty assistant content with a normal stop finish. */
export function emptyAssistantSse(): string[] {
  const delta = JSON.stringify({
    choices: [{ delta: { content: '' } }],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
  });
  return [
    `data: ${delta}\n\n`,
    `data: ${finish}\n\n`,
    `event: end\ndata: {"status":"complete"}\n\n`,
  ];
}

/** Two board_report tool calls in one assistant delta. */
export function duplicateBoardReportDeltaSse(taskId: string): string[] {
  const args = JSON.stringify({
    task_id: taskId,
    outcome: 'pass',
    summary: `Duplicate report for ${taskId}`,
  });
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_dup_a',
              type: 'function',
              function: { name: 'board_report', arguments: args },
            },
            {
              index: 1,
              id: 'call_dup_b',
              type: 'function',
              function: { name: 'board_report', arguments: args },
            },
          ],
        },
      },
    ],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
  });
  return [`data: ${delta}\n\n`, `data: ${finish}\n\n`, `event: end\ndata: {"status":"complete"}\n\n`];
}

/** board_report for a sibling task id — should not satisfy the active task. */
export function siblingTaskReportSse(wrongTaskId: string): string[] {
  return boardReportSse(wrongTaskId, 'pass', `Report meant for ${wrongTaskId}`);
}

/** Tester VERDICT format variants. */
export function testerVerdictPassUpperSse(): string[] {
  return proseSse('VERDICT:PASS — all checks green');
}

export function testerVerdictBuriedSse(): string[] {
  return proseSse('Ran npm test.\nEverything passed.\n\nVERDICT: pass\n\nThanks!');
}

export function testerConflictingVerdictsSse(): string[] {
  return proseSse('VERDICT: fail\nOn second thought: VERDICT: pass');
}

export function testerVerdictFailSse(): string[] {
  return testerVerdictSse('fail');
}

const DEFAULT_TOOL_RESULTS = {
  get_datetime: { result: '2026-07-26T12:00:00Z' },
  save_file: { result: 'saved' },
} as const;

/** Builder prose-only turns then a valid board_report (missing-report nudge path). */
export function builderProseNoReportScript(taskId: string): FakeApiScript {
  const prose = builderProseReadySse();
  return {
    slots: {
      [`${taskId}:build`]: [
        { sse: prose },
        { sse: prose },
        ...toolTurns(boardReportPassSse(taskId)),
      ],
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  };
}

/** Builder never reports — intended to quarantine after nudge budget at build cap. */
export function builderProseOnlyQuarantineScript(taskId: string): FakeApiScript {
  const prose = builderProseReadySse();
  const buildTurns = Array.from({ length: 12 }, () => ({ sse: prose }));
  return {
    slots: {
      [`${taskId}:build`]: buildTurns,
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  };
}

/** Tester fail verdict then recovery pass on retry. */
export function testerFailThenRecoverScript(taskId: string): FakeApiScript {
  return {
    slots: {
      [`${taskId}:build`]: [
        ...toolTurns(boardReportPassSse(taskId)),
        ...toolTurns(boardReportPassSse(taskId)),
      ],
      [`${taskId}:test`]: [
        { sse: testerVerdictFailSse() },
        { sse: testerVerdictSse('pass') },
      ],
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  };
}

/** Final integration tester omits VERDICT — should nudge, not pass silently. */
export function finalProseNoVerdictScript(taskId: string): FakeApiScript {
  return {
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportPassSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
      final: [{ sse: proseSse('Integration looked fine but I forgot VERDICT.') }],
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  };
}

/** Repeated context exceeded on build — intended quarantine at retry cap. */
export function contextExceededBuildCapScript(taskId: string): FakeApiScript {
  return {
    slots: {
      [`${taskId}:build`]: [
        { sse: generationErrorEndSse(CONTEXT_EXCEEDED_MESSAGES.couldNotComplete) },
        { sse: generationErrorEndSse(CONTEXT_EXCEEDED_MESSAGES.openAi) },
      ],
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  };
}

export const quirkFixtures = {
  malformedToolArgs: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: malformedToolArgsSse(taskId) },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  }),
  boardReportGreen: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportGreenSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  }),
  boardReportBadOutcome: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: boardReportBadOutcomeSse(taskId) },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  }),
  blankSummary: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: boardReportBlankSummarySse(taskId) },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  }),
  testerProseNoVerdict: testerProseNoVerdictScript,
  truncatedMidToolCall: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: truncatedMidToolCallSse(taskId) },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  }),
  nonexistentTool: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: nonexistentToolSse() },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  }),
  runawayRepetition: runawayRepetitionScript,
  contextExceededStreamThenRecover: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: [
        { sse: generationErrorEndSse(CONTEXT_EXCEEDED_MESSAGES.generic) },
        ...toolTurns(boardReportPassSse(taskId)),
      ],
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  }),
  contextExceededLmStudioThenRecover: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: [
        { sse: generationErrorEndSse(CONTEXT_EXCEEDED_MESSAGES.lmStudio) },
        ...toolTurns(boardReportPassSse(taskId)),
      ],
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  }),
  contextExceededPostThenRecover: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: [
        generationPostErrorTurn(
          400,
          JSON.stringify({
            error: {
              message: CONTEXT_EXCEEDED_MESSAGES.openAi,
              type: 'invalid_request_error',
              code: 'context_length_exceeded',
            },
          }),
        ),
        ...toolTurns(boardReportPassSse(taskId)),
      ],
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { get_datetime: { result: '2026-07-26T12:00:00Z' } },
  }),
  contextExceededTesterThenRecover: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportPassSse(taskId)),
      [`${taskId}:test`]: [
        { sse: generationErrorEndSse(CONTEXT_EXCEEDED_MESSAGES.llamaCpp) },
        { sse: generationErrorEndSse(CONTEXT_EXCEEDED_MESSAGES.llamaCpp) },
        { sse: testerVerdictSse('pass') },
      ],
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  builderProseNoReport: builderProseNoReportScript,
  builderProseOnlyQuarantine: builderProseOnlyQuarantineScript,
  boardReportOk: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportOkSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  boardReportSuccess: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportSuccessSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  boardReportEnvBlocked: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: [
        ...toolTurns(boardReportEnvBlockedSse(taskId)),
        ...toolTurns(boardReportPassSse(taskId)),
      ],
      [`${taskId}:fix`]: toolTurns(boardReportPassSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  boardReportFailThenRecover: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: boardReportFailSse(taskId) },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  partialValidToolArgs: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: partialValidToolArgsSse(taskId) },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  truncatedAfterToolName: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: truncatedAfterToolNameSse() },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  forbiddenDelegateTool: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: forbiddenDelegateToolSse() },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  multipleToolCallsInDelta: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(multipleToolCallsInDeltaSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  wrongFinishReason: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: wrongFinishReasonSse(taskId) },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  runawayMutatingThenReport: (taskId: string) => {
    const mutating = runawaySaveFileTurns(3).map((sse) => ({ sse }));
    mutating.push({ sse: boardReportPassSse(taskId) });
    return {
      slots: {
        [`${taskId}:build`]: appendPostToolAck(mutating),
        [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
      },
      toolResults: { ...DEFAULT_TOOL_RESULTS },
    };
  },
  maxToolTurnsThenRecover: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: [
        { sse: maxToolTurnsProseSse() },
        ...toolTurns(boardReportPassSse(taskId)),
      ],
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  emptyAssistantStream: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: [
        { sse: emptyAssistantSse() },
        ...toolTurns(boardReportPassSse(taskId)),
      ],
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  duplicateBoardReportDelta: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(duplicateBoardReportDeltaSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  siblingTaskReport: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: appendPostToolAck([
        { sse: siblingTaskReportSse('W1-B') },
        { sse: boardReportPassSse(taskId) },
      ]),
      [`${taskId}:test`]: slotTurns(testerVerdictSse('pass')),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  testerVerdictPassUpper: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportPassSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerVerdictPassUpperSse()),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  testerVerdictBuried: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportPassSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerVerdictBuriedSse()),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  testerConflictingVerdicts: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportPassSse(taskId)),
      [`${taskId}:test`]: slotTurns(testerConflictingVerdictsSse()),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  testerBoardReportInstead: (taskId: string) => ({
    slots: {
      [`${taskId}:build`]: toolTurns(boardReportPassSse(taskId)),
      [`${taskId}:test`]: toolTurns(boardReportPassSse(taskId)),
    },
    toolResults: { ...DEFAULT_TOOL_RESULTS },
  }),
  testerFailThenRecover: testerFailThenRecoverScript,
  finalProseNoVerdict: finalProseNoVerdictScript,
  contextExceededBuildCap: contextExceededBuildCapScript,
} satisfies Record<string, (taskId: string) => FakeApiScript>;
