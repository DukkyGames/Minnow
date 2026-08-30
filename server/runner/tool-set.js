/**
 * Default headless tool subset for server-side turns (MIN-701 / P2-D).
 *
 * The runner loop does not hardcode roles. Callers pass `tools` / this list
 * as an argument. This helper is the documented default for unattended
 * agent turns that must not require a renderer.
 *
 * Port vs exclude decisions: `server/runner/tool-set.md`.
 */

/**
 * Tools that POST /api/tools returns as `Not implemented: <name>` because they
 * run in the renderer (DOM, Electron preview, session UI, nested loops).
 * Keep in sync with `src/tools/client.ts` + `src/tools/browser-executor.ts`.
 */
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
  'board_init',
  'board_add_tasks',
  'board_update_task',
  'board_set_autonomy',
  'board_get_state',
  'board_report',
  'delegate_tasks',
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

/**
 * Server-registry tools a Builder/Tester-style turn actually needs.
 * Every id here must be absent from RENDERER_ONLY_TOOL_IDS and present in
 * `SERVER_TOOL_HANDLERS` (or plugin/MCP prefixes the caller injects).
 */
export const DEFAULT_HEADLESS_TOOL_IDS = Object.freeze([
  // files-read
  'list_directory',
  'read_file',
  'read_file_range',
  'read_document',
  'find_files',
  'get_file_metadata',
  'search_in_file',
  'grep',
  // files-write
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
  // git
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'git_add',
  'git_commit',
  'git_checkout',
  // code-exec
  'execute_command',
  'read_command_log',
  'list_running_commands',
  'stop_command',
  'start_background_command',
  'stop_background_command',
  'manage_dev_servers',
  'run_javascript',
  'run_python',
  // code-intel + lsp
  'repo_map',
  'find_symbol',
  'who_calls',
  'read_symbol',
  'explain_symbol',
  'get_lsp_diagnostics',
  'list_lsp_servers',
  // wiki (read + save_memory; no destructive manage_brain)
  'brain_search',
  'brain_read_page',
  'brain_list',
  'save_memory',
  // web backends (not the renderer `web_search` router)
  'web_search_ddg',
  'web_search_tavily',
  'web_search_searxng',
  'fetch_web_content',
  'rag_web_content',
  // shipped docs + design context
  'minnow_docs_search',
  'minnow_docs_read',
  'minnow_docs_list',
  'load_impeccable_context',
  'load_aesthetics_reference',
  'run_impeccable',
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isRendererOnlyTool(name) {
  return RENDERER_ONLY_SET.has(name);
}

/**
 * Ids from `ids` that require a renderer. Empty means the set is headless-safe.
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
