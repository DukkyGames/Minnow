import { getWorkAgent } from '../work-agent-registry';
import type { Chat } from '../../types';
import type { OpenAIFunctionDefinition } from '../../tools/definitions';
import {
  UI_DESIGNER_AGENT_ID,
  UI_DESIGNER_SKILL_ID,
  type UiDesignerMode,
} from './constants';
import { formatImpeccablePreflightLine, UI_DESIGNER_PREFLIGHT_INSTRUCTION } from './preflight';
import { parseUiDesignerMode, stripUiDesignerModePrefix } from './mode';
import { filterToolsForUiDesigner } from './tools';

export interface UiDesignerTurnContext {
  active: boolean;
  mode: UiDesignerMode;
  skillId: string | null;
  agentId: string | null;
  preflightLine: string;
  skillBodySuffix: string;
  statusHint: string;
}

export function isUiDesignerTurn(
  skillId: string | null,
  workAgentId: string | null | undefined,
): boolean {
  if (skillId === UI_DESIGNER_SKILL_ID) return true;
  if (workAgentId === UI_DESIGNER_AGENT_ID) return true;
  return false;
}

export function prepareUiDesignerTurn(
  chat: Chat,
  options: {
    skillId: string | null;
    userText: string;
    workAgentId?: string | null;
  },
): UiDesignerTurnContext {
  const agentId =
    options.skillId === UI_DESIGNER_SKILL_ID
      ? UI_DESIGNER_AGENT_ID
      : options.workAgentId ?? chat.workAgentId ?? null;

  const active = isUiDesignerTurn(options.skillId, agentId);
  if (!active) {
    return {
      active: false,
      mode: 'plan',
      skillId: options.skillId,
      agentId,
      preflightLine: '',
      skillBodySuffix: '',
      statusHint: '',
    };
  }

  const mode = parseUiDesignerMode(options.userText, chat);
  chat.uiDesignerMode = mode;

  const preflightLine = formatImpeccablePreflightLine(
    {
      mutation: mode === 'plan' ? 'closed' : 'open',
      imageGate: mode === 'plan' ? 'skipped:plan_mode' : 'pass',
    },
    mode,
  );

  const modeLabel = mode === 'plan' ? 'plan mode (no edits)' : 'implement mode';
  const statusHint = `UI Designer · ${modeLabel}`;

  return {
    active: true,
    mode,
    skillId: options.skillId,
    agentId: UI_DESIGNER_AGENT_ID,
    preflightLine,
    skillBodySuffix: `\n\n${UI_DESIGNER_PREFLIGHT_INSTRUCTION}\n\n${preflightLine}`,
    statusHint,
  };
}

export function augmentSkillBodyForUiDesigner(
  skillBody: string,
  ctx: UiDesignerTurnContext,
): string {
  if (!ctx.active) return skillBody;
  return `${skillBody.trim()}\n${ctx.skillBodySuffix}`;
}

export function applyUiDesignerToolFilter(
  tools: OpenAIFunctionDefinition[],
  ctx: UiDesignerTurnContext,
): OpenAIFunctionDefinition[] {
  if (!ctx.active) return tools;
  return filterToolsForUiDesigner(tools);
}

export function getUiDesignerWorkAgent() {
  return getWorkAgent(UI_DESIGNER_AGENT_ID);
}

export function normalizeUiDesignerUserText(userText: string): string {
  return stripUiDesignerModePrefix(userText);
}

export function listUiDesignerPickerOptions(): Array<{
  id: string;
  label: string;
  description?: string;
}> {
  return [
    {
      id: 'plan',
      label: 'Plan',
      description: 'Review and recommend — no file edits',
    },
    {
      id: 'implement',
      label: 'Implement',
      description: 'Apply UI changes with restricted tools',
    },
  ];
}

export { parseUiDesignerMode, stripUiDesignerModePrefix };
