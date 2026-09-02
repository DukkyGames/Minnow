export const RENDERER_ONLY_TOOL_IDS = Object.freeze([
  'get_datetime',
  'calculate',
  'get_system_info',
  'read_clipboard',
  'write_clipboard',
  'ask_question',
  'wikipedia_search',
  'web_search',
  'spawn_sub_agent',
  'cancel_sub_agent',
  'list_sub_agents',
  'get_sub_agent_status',
  'set_chat_mode',
  'create_chat_with_mode',
  'launch_minnow_app',
  'propose_mode_switch',
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
  'todo_write',
  'get_appearance',
  'update_appearance',
  'upload_appearance_asset',
  'recall_chat_context',
  'recall_turn_full',
]);

const RENDERER_ONLY_SET = new Set(RENDERER_ONLY_TOOL_IDS);

export const DEFAULT_HEADLESS_TOOL_IDS = Object.freeze([
  'list_directory',
  'read_file',
  'read_file_range',
  'read_document',
  'find_files',
  'get_file_metadata',
  'search_in_file',
  'grep',
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
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'git_add',
  'git_commit',
  'git_checkout',
  'execute_command',
  'read_command_log',
  'list_running_commands',
  'stop_command',
  'start_background_command',
  'stop_background_command',
  'manage_dev_servers',
  'run_javascript',
  'run_python',
  'repo_map',
  'find_symbol',
  'who_calls',
  'read_symbol',
  'explain_symbol',
  'get_lsp_diagnostics',
  'list_lsp_servers',
  'brain_search',
  'brain_read_page',
  'brain_list',
  'save_memory',
  'web_search_ddg',
  'web_search_tavily',
  'web_search_searxng',
  'fetch_web_content',
  'rag_web_content',
  'minnow_docs_search',
  'minnow_docs_read',
  'minnow_docs_list',
  'load_impeccable_context',
  'load_aesthetics_reference',
  'run_impeccable',
]);

export const BROWSER_TOOL_IDS = Object.freeze([
  'browser_drive_navigate',
  'browser_drive_read_page',
  'browser_drive_click',
  'browser_drive_type',
  'browser_drive_read_console',
  'browser_drive_read_network',
  'browser_drive_screenshot',
  'browser_drive_resize',
]);

const BROWSER_TOOL_SET = new Set(BROWSER_TOOL_IDS);

export const FINAL_TESTER_TOOL_IDS = Object.freeze([
  ...DEFAULT_HEADLESS_TOOL_IDS,
  ...BROWSER_TOOL_IDS,
]);

/**
 * @param {string} role
 * @returns {readonly string[]}
 */
export function headlessToolIdsForRole(role) {
  return role === 'final' ? FINAL_TESTER_TOOL_IDS : DEFAULT_HEADLESS_TOOL_IDS;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isBrowserDriverTool(name) {
  return BROWSER_TOOL_SET.has(name);
}

/**
 * @param {Iterable<string>} ids
 * @returns {string[]}
 */
export function browserToolsIn(ids) {
  const hits = [];
  for (const id of ids) {
    if (BROWSER_TOOL_SET.has(id)) hits.push(id);
  }
  return hits;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isRendererOnlyTool(name) {
  return RENDERER_ONLY_SET.has(name);
}

/**
 * @param {Iterable<string>} ids
 * @returns {string[]}
 */
export function rendererOnlyToolsIn(ids) {
  const hits = [];
  for (const id of ids) {
    if (RENDERER_ONLY_SET.has(id)) hits.push(id);
  }
  return hits;
}
