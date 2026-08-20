/**
 * Auto probe specs for rows that used to be manual — browser, sub-agents, board,
 * recall, email, calendar, and the desktop surface.
 *
 * These rows were marked manual because *executing* them needs the Electron browser
 * pane, a live orchestration session, or a connected mailbox. The matrix scores the
 * **model**, though, so each row runs as an emit-only probe: the tools are offered for
 * real and stubbed on execution (see `execute-tool.ts`), and the verdict reads which
 * tools the model reached for and whether it used the ids the stub handed back.
 */

import {
  argsTextFor,
  fail,
  hasAnyTool,
  hasTool,
  partial,
  pass,
  usedStubUid,
} from './probe-helpers.ts';
import {
  CAP_STUB_BOARD_TASK_ID,
  CAP_STUB_SNAPSHOT_UIDS,
  CAP_STUB_SUB_AGENT_ID,
  CAP_STUB_THREAD_ID,
} from './stub-fixtures.ts';
import type { CapabilityProbeRunOutput, CapabilityProbeSpec } from './types.ts';

/** True when any call to `name` quoted one of the ids the stub handed back. */
function usedStubId(
  out: CapabilityProbeRunOutput,
  name: string,
  ids: readonly string[],
): boolean {
  const args = argsTextFor(out, name);
  return ids.some((id) => args.includes(id));
}

export const SURFACE_PROBES: Record<string, CapabilityProbeSpec> = {
  'browser-navigate': {
    kind: 'tool-chain',
    maxToolRounds: 8,
    toolIds: [
      'browser_new_tab',
      'browser_navigate',
      'browser_list',
      'browser_switch_tab',
      'browser_close_tab',
    ],
    emitOnly: true,
    verdict: (out) => {
      const opened = hasAnyTool(out.toolCalls, ['browser_new_tab', 'browser_navigate']);
      const listed = hasTool(out.toolCalls, 'browser_list');
      const addressed = /example\.com/i.test(
        `${argsTextFor(out, 'browser_navigate')} ${argsTextFor(out, 'browser_new_tab')}`,
      );
      if (opened && listed && addressed) return pass('Opened the requested URL, then listed tabs');
      if (opened && listed) return partial('Opened a tab and listed, but not the requested URL');
      if (opened) return partial('Opened a tab without listing them');
      return fail('No browser navigation tools called');
    },
  },
  'browser-snapshot': {
    kind: 'tool-chain',
    maxToolRounds: 10,
    toolIds: ['browser_snapshot', 'browser_fill', 'browser_click'],
    emitOnly: true,
    verdict: (out) => {
      if (!hasTool(out.toolCalls, 'browser_snapshot')) {
        return hasAnyTool(out.toolCalls, ['browser_fill', 'browser_click'])
          ? fail('Clicked or filled without snapshotting for refs first')
          : fail('No browser snapshot tools called');
      }
      const acted = hasAnyTool(out.toolCalls, ['browser_fill', 'browser_click']);
      if (!acted) return partial('Snapshotted but never acted on the page');
      const uidOk =
        usedStubUid(out, 'browser_fill', CAP_STUB_SNAPSHOT_UIDS) ||
        usedStubUid(out, 'browser_click', CAP_STUB_SNAPSHOT_UIDS);
      return uidOk
        ? pass('Snapshotted, then acted on the uids it returned')
        : partial('Acted on the page without the uids the snapshot returned');
    },
  },
  'browser-eval': {
    kind: 'tool-chain',
    maxToolRounds: 8,
    toolIds: ['browser_screenshot', 'browser_eval'],
    emitOnly: true,
    verdict: (out) => {
      const shot = hasTool(out.toolCalls, 'browser_screenshot');
      const evaluated = hasTool(out.toolCalls, 'browser_eval');
      if (shot && evaluated) return pass('Screenshot plus eval for the computed style');
      if (evaluated) return partial('Evaluated the page without a screenshot');
      if (shot) return partial('Screenshot only — no computed style read');
      return fail('No screenshot or eval call');
    },
  },

  'agents-sub-agent-control': {
    kind: 'tool-chain',
    maxToolRounds: 8,
    toolIds: ['list_sub_agents', 'get_sub_agent_status', 'cancel_sub_agent'],
    emitOnly: true,
    verdict: (out) => {
      const listed = hasAnyTool(out.toolCalls, ['list_sub_agents', 'get_sub_agent_status']);
      const cancelled = hasTool(out.toolCalls, 'cancel_sub_agent');
      if (!listed && !cancelled) return fail('No sub-agent tools called');
      if (listed && cancelled) {
        return usedStubId(out, 'cancel_sub_agent', [CAP_STUB_SUB_AGENT_ID])
          ? pass('Listed sub-agents, then cancelled the one that was running')
          : partial('Cancelled without using the id the listing returned');
      }
      if (listed) return partial('Inspected sub-agents but never cancelled');
      return partial('Cancelled without checking what was running');
    },
  },
  'agents-board-init': {
    kind: 'tool-chain',
    maxToolRounds: 8,
    toolIds: ['board_init', 'board_update_task', 'board_get_state'],
    emitOnly: true,
    verdict: (out) => {
      const seeded = hasTool(out.toolCalls, 'board_init');
      const moved = hasTool(out.toolCalls, 'board_update_task');
      if (seeded && moved) return pass('Seeded the board and moved a task');
      if (seeded) return partial('Seeded the board but left every task untouched');
      if (moved) return partial('Updated tasks without seeding a board');
      return fail('No board tools called');
    },
  },
  'agents-board-report': {
    kind: 'tool-chain',
    maxToolRounds: 8,
    toolIds: ['board_get_state', 'board_report', 'board_update_task'],
    emitOnly: true,
    verdict: (out) => {
      const reported = hasTool(out.toolCalls, 'board_report');
      const read = hasTool(out.toolCalls, 'board_get_state');
      if (reported) {
        return usedStubId(out, 'board_report', [CAP_STUB_BOARD_TASK_ID])
          ? pass('Reported completion against the assigned task')
          : partial('Reported completion without naming the assigned task');
      }
      if (read) return partial('Read the board but went quiet instead of reporting');
      if (hasTool(out.toolCalls, 'board_update_task')) {
        return partial('Updated the task without reporting back');
      }
      return fail('No completion report');
    },
  },
  'agents-delegate-tasks': {
    kind: 'tool-call',
    maxToolRounds: 8,
    toolIds: ['delegate_tasks'],
    emitOnly: true,
    verdict: (out) => {
      if (!hasTool(out.toolCalls, 'delegate_tasks')) {
        return fail('No delegate_tasks call');
      }
      const calls = out.toolCalls.filter((tc) => tc.function?.name === 'delegate_tasks');
      if (calls.length >= 2) {
        return pass('Delegated multiple tasks in one fan-out');
      }
      return partial('Delegated once but did not fan out every ready task');
    },
  },

  'knowledge-recall': {
    kind: 'tool-call',
    maxToolRounds: 6,
    toolIds: ['recall_chat_context', 'recall_turn_full'],
    emitOnly: true,
    verdict: (out) => {
      if (hasAnyTool(out.toolCalls, ['recall_chat_context', 'recall_turn_full'])) {
        return pass('Looked the earlier turn up instead of guessing');
      }
      // Inventing a checklist item it was never given is worse than admitting the gap.
      return /don'?t (have|recall)|no (record|history)|cannot (find|recall)/i.test(
        out.contentText || out.text,
      )
        ? partial('Admitted it could not recall, but never called a recall tool')
        : fail('Answered from thin air without calling a recall tool');
    },
  },

  'apps-email-list': {
    kind: 'tool-chain',
    maxToolRounds: 8,
    toolIds: ['list_mail', 'search_mail', 'get_thread'],
    emitOnly: true,
    verdict: (out) => {
      const listed = hasAnyTool(out.toolCalls, ['list_mail', 'search_mail']);
      const opened = hasTool(out.toolCalls, 'get_thread');
      if (listed && opened) {
        return usedStubId(out, 'get_thread', [CAP_STUB_THREAD_ID])
          ? pass('Listed mail, then opened a thread it had actually seen')
          : partial('Opened a thread id the listing never returned');
      }
      if (listed) return partial('Listed mail but never opened the thread');
      if (opened) return partial('Opened a thread without listing first');
      return fail('No mail tools called');
    },
  },
  'apps-email-draft': {
    kind: 'tool-chain',
    maxToolRounds: 8,
    toolIds: ['list_mail', 'draft_reply', 'email_action'],
    emitOnly: true,
    verdict: (out) => {
      const drafted = hasTool(out.toolCalls, 'draft_reply');
      // The row's rule is draft, never act destructively on the thread.
      const destructive = /"action"\s*:\s*"(delete|archive)"/i.test(
        argsTextFor(out, 'email_action'),
      );
      if (drafted && !destructive) return pass('Drafted a reply and sent nothing');
      if (drafted) return partial('Drafted a reply but also archived or deleted the thread');
      if (destructive) return fail('Acted destructively on the thread instead of drafting');
      return fail('No draft_reply call');
    },
  },
  'apps-email-summarize': {
    kind: 'tool-chain',
    maxToolRounds: 8,
    toolIds: ['summarize_inbox', 'generate_reply_variants', 'list_mail'],
    emitOnly: true,
    verdict: (out) => {
      const summarized = hasTool(out.toolCalls, 'summarize_inbox');
      const variants = hasTool(out.toolCalls, 'generate_reply_variants');
      if (summarized && variants) return pass('Summarized the inbox and asked for reply options');
      if (summarized) return partial('Summarized without generating reply options');
      if (variants) return partial('Generated replies without summarizing');
      return fail('No inbox summary tools called');
    },
  },
  'apps-calendar': {
    kind: 'tool-call',
    toolIds: ['manage_calendar'],
    emitOnly: true,
    verdict: (out) =>
      hasTool(out.toolCalls, 'manage_calendar')
        ? pass('manage_calendar emitted')
        : fail('No manage_calendar call'),
  },
};
