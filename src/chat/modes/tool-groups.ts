/**
 * Tool group definitions for per-mode allowlists (Input Token Reduction — Phase 2).
 * Group token costs are documented in documentation/plans/context-reduction.md.
 */

import type { ModeId, ModeToolPolicy } from './types';

/** Named tool groups keyed for mode matrix expansion. */
export const TOOL_GROUP_IDS = {
  'util-basic': [
    'get_datetime',
    'calculate',
    'get_system_info',
    'read_clipboard',
    'write_clipboard',
  ],
  web: ['web_search', 'wikipedia_search', 'fetch_web_content', 'rag_web_content'],
  'files-read': [
    'list_directory',
    'read_file',
    'read_file_range',
    'find_files',
    'get_file_metadata',
    'search_in_file',
    'grep',
  ],
  'files-write': [
    'save_file',
    'append_file',
    'insert_at_line',
    'replace_text_in_file',
    'make_directory',
    'move_file',
    'copy_file',
    'delete_path',
    'create_pdf',
    'create_spreadsheet',
    'create_word_document',
  ],
  'git-read': ['git_status', 'git_diff', 'git_log', 'git_branch'],
  'git-write': ['git_add', 'git_commit', 'git_checkout'],
  'code-exec': [
    'execute_command',
    'read_command_log',
    'list_running_commands',
    'stop_command',
    'start_background_command',
    'stop_background_command',
    'manage_dev_servers',
    'run_javascript',
    'run_python',
  ],
  'code-intel': ['repo_map', 'find_symbol', 'who_calls', 'read_symbol', 'explain_symbol'],
  lsp: ['get_lsp_diagnostics', 'list_lsp_servers'],
  'sub-agents': [
    'spawn_sub_agent',
    'cancel_sub_agent',
    'list_sub_agents',
    'get_sub_agent_status',
  ],
  board: [
    'board_init',
    'board_update_task',
    'board_set_autonomy',
    'board_get_state',
    'board_report',
    'delegate_tasks',
  ],
  'bug-board': ['bug_add', 'bug_update', 'bug_get_state'],
  'mode-mgmt': [
    'set_chat_mode',
    'create_chat_with_mode',
    'launch_minnow_app',
    'propose_mode_switch',
  ],
  ask: ['ask_question'],
  browser: [
    'browser_list',
    'browser_navigate',
    'browser_new_tab',
    'browser_switch_tab',
    'browser_close_tab',
    'browser_snapshot',
    'browser_click',
    'browser_fill',
    'browser_eval',
    'browser_screenshot',
    'request_browser_origin_access',
  ],
  // Split so board workers can read the wiki and save what they learn without
  // also getting page rewrites, ingest, or destructive brain management.
  'brain-core': ['brain_search', 'brain_read_page', 'brain_list', 'save_memory'],
  'brain-admin': [
    'brain_write_page',
    'brain_append_log',
    'brain_ingest_source',
    'manage_brain',
  ],
  recall: ['recall_chat_context', 'recall_turn_full'],
  settings: ['search_settings', 'get_settings', 'update_settings'],
  appearance: ['get_appearance', 'update_appearance', 'upload_appearance_asset'],
  diagnostics: ['read_diagnostics'],
  email: [
    'list_mail',
    'search_mail',
    'get_thread',
    'draft_reply',
    'summarize_inbox',
    'generate_reply_variants',
    'email_action',
  ],
  calendar: ['manage_calendar'],
  impeccable: ['load_impeccable_context', 'load_aesthetics_reference', 'run_impeccable'],
  todo: ['todo_write'],
} as const;

export type ToolGroupId = keyof typeof TOOL_GROUP_IDS;

/** All group ids (stable order for tests). */
export const TOOL_GROUP_ID_LIST: ToolGroupId[] = Object.keys(
  TOOL_GROUP_IDS,
) as ToolGroupId[];

/** Plan mode: files-write limited to planner doc writes (see context-reduction matrix footnote 1). */
export const PLAN_FILES_WRITE_ALLOW = ['save_file', 'make_directory'] as const;

/**
 * Per-mode matrix: ● keep · ○ drop. See documentation/plans/context-reduction.md.
 * Orchestrate sub-agents: group is ● but spawn/cancel stay denied (footnote 2).
 * Plan code-exec: kept per final matrix (MIN-332) — shell runs allowed for planning probes.
 */
/** Desktop chat: every built-in tool group (full MinnowOS assistant surface). */
export const DESKTOP_ALLOWED_GROUPS: readonly ToolGroupId[] = TOOL_GROUP_ID_LIST;

export const MODE_ALLOWED_GROUPS: Record<ModeId, readonly ToolGroupId[]> = {
  desktop: DESKTOP_ALLOWED_GROUPS,
  email: [
    'util-basic',
    'web',
    'files-read',
    'files-write',
    'ask',
    'brain-core',
    'brain-admin',
    'email',
    'calendar',
  ],
  general: [
    'util-basic',
    'web',
    'files-read',
    'files-write',
    'git-read',
    'git-write',
    'code-exec',
    'code-intel',
    'lsp',
    'sub-agents',
    'bug-board',
    'mode-mgmt',
    'ask',
    'browser',
    'brain-core',
    'brain-admin',
    'recall',
    'settings',
    'impeccable',
  ],
  build: [
    'util-basic',
    'web',
    'files-read',
    'files-write',
    'git-read',
    'git-write',
    'code-exec',
    'code-intel',
    'lsp',
    'sub-agents',
    'mode-mgmt',
    'ask',
    'browser',
    'brain-core',
    'brain-admin',
    'recall',
    'impeccable',
    'todo',
  ],
  plan: [
    'util-basic',
    'web',
    'files-read',
    'git-read',
    'code-exec',
    'code-intel',
    'lsp',
    'sub-agents',
    'mode-mgmt',
    'ask',
    'browser',
    'brain-core',
    'brain-admin',
    'recall',
    'impeccable',
  ],
  'super-plan': [
    'util-basic',
    'web',
    'files-read',
    'git-read',
    'code-intel',
    'lsp',
    'sub-agents',
    'mode-mgmt',
    'ask',
    'browser',
    'brain-core',
    'brain-admin',
    'recall',
    'impeccable',
  ],
  orchestrate: [
    'util-basic',
    'files-read',
    'git-read',
    'code-intel',
    'sub-agents',
    'board',
    'mode-mgmt',
    'ask',
    'brain-core',
    'brain-admin',
    'recall',
  ],
  debug: [
    'util-basic',
    'web',
    'files-read',
    'files-write',
    'git-read',
    'git-write',
    'code-exec',
    'code-intel',
    'lsp',
    'sub-agents',
    'bug-board',
    'mode-mgmt',
    'ask',
    'browser',
    'brain-core',
    'brain-admin',
    'recall',
    'impeccable',
    'todo',
    'diagnostics',
  ],
  /** First-run wizard tour guide — safe demo set: no shell, no writes, no email/calendar. */
  onboarding: ['util-basic', 'web', 'files-read', 'brain-core', 'brain-admin', 'ask'],
};

/** Per-mode explicit deny overrides applied after group expansion. */
export const MODE_TOOL_DENY_OVERRIDES: Partial<Record<ModeId, readonly string[]>> = {
  plan: [
    'append_file',
    'insert_at_line',
    'replace_text_in_file',
    'move_file',
    'copy_file',
    'delete_path',
    'update_settings',
  ],
  'super-plan': [
    'append_file',
    'insert_at_line',
    'replace_text_in_file',
    'move_file',
    'copy_file',
    'delete_path',
    'update_settings',
  ],
  orchestrate: ['spawn_sub_agent', 'cancel_sub_agent'],
};

/** Per-mode explicit allow overrides applied after group expansion. */
export const MODE_TOOL_ALLOW_OVERRIDES: Partial<Record<ModeId, readonly string[]>> = {
  plan: [...PLAN_FILES_WRITE_ALLOW],
  'super-plan': [...PLAN_FILES_WRITE_ALLOW],
};

/** Flatten group ids to a deduplicated tool id list. */
export function expandToolGroups(groups: readonly ToolGroupId[]): string[] {
  const ids = new Set<string>();
  for (const groupId of groups) {
    for (const toolId of TOOL_GROUP_IDS[groupId]) {
      ids.add(toolId);
    }
  }
  return [...ids];
}

/** Build a deny-by-default policy from allowed groups plus optional overrides. */
export function allowGroupsToolPolicy(
  modeId: ModeId,
  groups: readonly ToolGroupId[],
): ModeToolPolicy {
  const allowed = new Set(expandToolGroups(groups));
  for (const id of MODE_TOOL_ALLOW_OVERRIDES[modeId] ?? []) {
    allowed.add(id);
  }
  for (const id of MODE_TOOL_DENY_OVERRIDES[modeId] ?? []) {
    allowed.delete(id);
  }
  const tools: Record<string, 'allow'> = {};
  for (const id of allowed) {
    tools[id] = 'allow';
  }
  return { default: 'deny', tools };
}

/**
 * Orchestrator board member roles (builder / tester / fixer). Tool allowlists are
 * enforced in {@link applyBoardMemberToolFilter} — see MIN-333 matrix in
 * documentation/plans/context-reduction.md.
 */
export type BoardMemberRole = 'build' | 'test' | 'fix';

/** Board subset for all roles — mutating board tools stay stripped by the filter. */
export const BOARD_ROLE_BOARD_SUBSET = ['board_get_state', 'board_report'] as const;

/**
 * Per-role group matrix for orchestrator board chats (MIN-333). Build and fix differ
 * only by browser (build ●, fix ○). Tester omits files-write.
 *
 * All three get `brain-core`: workers hold the discovery context, so they must be
 * able to look up prior findings and record new ones themselves. Routing writes
 * through the orchestrator instead would strip the detail worth saving.
 */
export const BOARD_ROLE_ALLOWED_GROUPS: Record<BoardMemberRole, readonly ToolGroupId[]> = {
  build: [
    'util-basic',
    'web',
    'files-read',
    'files-write',
    'git-read',
    'git-write',
    'code-exec',
    'code-intel',
    'lsp',
    'browser',
    'brain-core',
  ],
  test: [
    'util-basic',
    'web',
    'files-read',
    'git-read',
    'git-write',
    'code-exec',
    'code-intel',
    'lsp',
    'browser',
    'brain-core',
  ],
  fix: [
    'util-basic',
    'web',
    'files-read',
    'files-write',
    'git-read',
    'git-write',
    'code-exec',
    'code-intel',
    'lsp',
    'brain-core',
  ],
};

/** Expand a board role matrix row to the allowed tool id set (incl. board subset). */
export function expandBoardRoleAllowedTools(role: BoardMemberRole): Set<string> {
  const allowed = new Set(expandToolGroups(BOARD_ROLE_ALLOWED_GROUPS[role]));
  for (const id of BOARD_ROLE_BOARD_SUBSET) {
    allowed.add(id);
  }
  return allowed;
}

/** Inverse map: tool id → groups that contain it (for matrix tests). */
export function buildToolIdToGroupsMap(): Map<string, ToolGroupId[]> {
  const map = new Map<string, ToolGroupId[]>();
  for (const groupId of TOOL_GROUP_ID_LIST) {
    for (const toolId of TOOL_GROUP_IDS[groupId]) {
      const existing = map.get(toolId) ?? [];
      existing.push(groupId);
      map.set(toolId, existing);
    }
  }
  return map;
}
