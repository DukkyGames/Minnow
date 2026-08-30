/**
 * Bounded parallel vs sequential classification for one assistant tool_calls batch.
 *
 * Port of `src/tools/parallel-tool-policy.ts`. Do not invent new concurrency
 * rules here — if the renderer copy changes, this file must change with it.
 * Duplicated as literals so `server/runner/` never imports `src/`.
 */

/** Max concurrent read-only tool executions per parallel segment. */
export const MAX_PARALLEL_READ_TOOLS = 6;

/**
 * Extra read utilities marked parallel-safe in the renderer copy even when
 * they are not in the result-cache policy table.
 */
const PARALLEL_EXTRA_WHITELIST = new Set([
  'get_datetime',
  'calculate',
  'get_system_info',
  'wikipedia_search',
  'list_sub_agents',
  'get_sub_agent_status',
]);

/**
 * Tools that always run one-at-a-time. Union of the renderer deny set:
 * user-input blocking tools, clipboard, spawn/cancel, mutating groups
 * (files-write, git-write, code-exec, browser, task-graph, issues, mode-mgmt),
 * wiki mutators, and the destructive wiki tool.
 */
const SEQUENTIAL_DENY = new Set([
  'ask_question',
  'propose_mode_switch',
  'read_clipboard',
  'write_clipboard',
  'spawn_sub_agent',
  'cancel_sub_agent',
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
  // git-write
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
  // browser (prefix rule also catches these)
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
  // task-graph tools (V1 names; sequential even if a caller injects them)
  'board_init',
  'board_add_tasks',
  'board_update_task',
  'board_set_autonomy',
  'board_get_state',
  'board_report',
  'delegate_tasks',
  // issues
  'issue_add',
  'issue_update',
  'issue_link',
  'issue_get_state',
  'issue_delete',
  'issue_search',
  'issue_comment',
  'issue_assign',
  'issue_unlink',
  'issue_move',
  // mode-mgmt
  'set_chat_mode',
  'create_chat_with_mode',
  'launch_minnow_app',
  // wiki mutators
  'brain_write_page',
  'brain_append_log',
  'brain_ingest_source',
  'save_memory',
  'manage_brain',
]);

/**
 * Cacheable-read policy from `src/tools/tool-cache-policy.ts`.
 * `cacheable: false` (or missing) means sequential unless whitelisted.
 */
const CACHEABLE_READ = new Set([
  'read_file',
  'read_file_range',
  'list_directory',
  'search_in_file',
  'grep',
  'get_file_metadata',
  'find_files',
  'git_status',
  'git_diff',
  'git_log',
  'list_lsp_servers',
  'load_impeccable_context',
  'load_aesthetics_reference',
  'web_search',
  'web_search_ddg',
  'web_search_tavily',
  'fetch_web_content',
  'rag_web_content',
  'read_document',
]);

/**
 * True when a tool may run concurrently with other parallel-safe tools.
 * @param {string} name
 * @returns {boolean}
 */
export function isParallelSafeTool(name) {
  if (
    name.startsWith('browser_') ||
    name.startsWith('mcp__') ||
    name.startsWith('plugin__')
  ) {
    return false;
  }
  if (SEQUENTIAL_DENY.has(name)) {
    return false;
  }
  if (PARALLEL_EXTRA_WHITELIST.has(name)) {
    return true;
  }
  return CACHEABLE_READ.has(name);
}

/**
 * Split tool_calls into ordered segments: consecutive parallel-safe calls share
 * one parallel segment; each non-safe call is its own sequential segment.
 * @param {Array<{ function?: { name?: string } }>} toolCalls
 * @returns {Array<{ kind: 'parallel' | 'sequential', calls: typeof toolCalls }>}
 */
export function partitionToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
  }

  /** @type {Array<{ kind: 'parallel' | 'sequential', calls: typeof toolCalls }>} */
  const segments = [];
  /** @type {typeof toolCalls} */
  let parallelBuffer = [];

  function flushParallel() {
    if (parallelBuffer.length === 0) return;
    segments.push({ kind: 'parallel', calls: parallelBuffer });
    parallelBuffer = [];
  }

  for (const tc of toolCalls) {
    const name = typeof tc?.function?.name === 'string' ? tc.function.name : '';
    if (isParallelSafeTool(name)) {
      parallelBuffer.push(tc);
      continue;
    }
    flushParallel();
    segments.push({ kind: 'sequential', calls: [tc] });
  }

  flushParallel();
  return segments;
}
