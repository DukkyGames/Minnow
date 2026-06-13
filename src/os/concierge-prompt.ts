/**
 * Prompt builder for the MinnowOS concierge structured planner.
 */

import { APPS } from './app-registry';
import type { WorkspaceRecentItem } from '../config/workspace-api';
import type { ApiMessage } from '../types';

export interface ConciergePromptContext {
  /** Indexed recent workspaces (only entries with exists === true are valid targets). */
  recentWorkspaces: ReadonlyArray<WorkspaceRecentItem & { index: number }>;
  /** Current top-bar model id, when known. */
  modelId?: string;
}

/** Few-shot examples that teach seed refinement and auto-run behavior. */
const FEW_SHOT = `
Examples:
User: "Let's research apple stock"
{"app_id":"research","seed":"Apple stock (AAPL)","auto_run":true}

User: "Find bugs in my finance app"
{"app_id":"code","seed":"Find bugs in the finance app","mode_id":"debug","workspace_index":0,"auto_run":true}

User: "Look for bugs in my finance app"
{"app_id":"code","seed":"Find bugs in the finance app","mode_id":"debug","workspace_index":0,"auto_run":true}

User: "Let's code in our finance app"
{"app_id":"code","workspace_index":0,"mode_id":"build","auto_run":false}

User: "Change my theme to dark"
{"app_id":"settings","seed":"","settings_section":"general","auto_run":false}

User: "Explain how recursion works"
{"app_id":"chat","seed":"Explain how recursion works","auto_run":false}
`.trim();

/** Build system + user messages for a non-streaming concierge plan request. */
export function buildConciergeMessages(
  userText: string,
  context: ConciergePromptContext,
): ApiMessage[] {
  const apps = APPS.map((a) => `- ${a.id}: ${a.name} — ${a.description}`).join('\n');

  const workspaceLines =
    context.recentWorkspaces.length === 0
      ? '(none — omit workspace_index or use 0 only when user names a project you cannot match)'
      : context.recentWorkspaces
          .map(
            (w) =>
              `[${w.index}] ${w.label} (${w.path})${w.isCurrent ? ' [current]' : ''}`,
          )
          .join('\n');

  const system = `You are the MinnowOS concierge router. Given a user request, pick the best app and return ONLY a JSON object (no markdown fences, no prose).

Apps:
${apps}

Recent workspaces (use workspace_index when the user refers to a project by name or domain):
${workspaceLines}

JSON schema:
- app_id (required): one of code|chat|research|experts|bench|settings
- seed (optional): concise task text for the destination app — strip filler ("let's", "please", "can you"). Omit seed (or use empty string) when the user only wants to open/switch workspace without a specific task.
- mode_id (optional): debug|build|plan|general|orchestrate|reef — only when app_id is code
- workspace_index (optional): integer index into the recent workspace list above
- auto_run (optional): true when the user wants immediate execution (research runs, code debug/fix/build)
- settings_section (optional): general|providers|appearance-related subsection when opening settings

Rules:
- Prefer code for bug hunts, implementation, refactors, and repo work; set mode_id debug for bug/fix hunts.
- When the user only wants to code/work in a named project (no specific task), set workspace_index, omit seed, and auto_run false.
- Prefer research for investigation, stock/market topics, and multi-source synthesis; set auto_run true when actionable.
- Prefer chat for quick Q&A without tools-heavy workspace work — never use chat for bug hunts, fixes, or repo edits (use code + debug mode).
- Match workspace_index only when the label/path clearly fits the user's project reference.
- Output valid JSON only.

${FEW_SHOT}`;

  const modelNote = context.modelId?.trim()
    ? `\nActive model: ${context.modelId.trim()}`
    : '';

  return [
    { role: 'system', content: system },
    { role: 'user', content: `${userText.trim()}${modelNote}` },
  ];
}
