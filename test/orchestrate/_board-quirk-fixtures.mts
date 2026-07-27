/**
 * Shared SSE chunks + FakeApiScript builders for headless board E2E and fake-model scenarios.
 */

import type { FakeApiScript } from './_fake-api-router.mts';

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
export function appendPostToolAck(
  turns: Array<{ sse: string[] }>,
): Array<{ sse: string[] }> {
  return [...turns, { sse: postToolAckSse() }];
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
} satisfies Record<string, (taskId: string) => FakeApiScript>;
