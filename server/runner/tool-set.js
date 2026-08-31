/**
 * Default headless tool subset for server-side turns (MIN-701 / P2-D).
 *
 * The runner loop does not hardcode roles. Callers pass `tools` / this list
 * as an argument. This helper is the documented default for unattended
 * agent turns that must not require a renderer.
 *
 * Port vs exclude decisions: `server/runner/tool-set.md`.
 *
 * This module has no imports and must keep none: it is re-exported from the
 * isomorphic `index.js` barrel, and the package guard
 * (`test/runner/package-guard.test.mjs`) requires the shared runner's whole
 * runtime closure to stay inside `server/runner/`. Names that live elsewhere
 * are therefore duplicated here and pinned by a test, the same arrangement
 * `RENDERER_ONLY_TOOL_IDS` already uses for the renderer catalog.
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
 * P5-B — the browser driver surface (MIN-720).
 *
 * These are **not** the `browser_*` ids above. Those run in the renderer
 * against an Electron `WebContentsView`; these are server-side, headless, and
 * dispatched through the ordinary registry. The names are disjoint on purpose.
 *
 * Keep in sync with `server/tools/browser-driver-tool-defs.js`, which owns the
 * handlers' schemas. The P5-B tool-surface test pins the two lists together and
 * fails if they ever diverge.
 */
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

/**
 * The Final Tester's set: the headless default plus the browser.
 *
 * A Builder that can drive a browser will drive one, and per-task verification
 * is not where a rendered page belongs — a Builder proving its own work in a
 * browser is exactly the self-marking this pipeline separates roles to avoid.
 * So the browser lives here and only here.
 */
export const FINAL_TESTER_TOOL_IDS = Object.freeze([
  ...DEFAULT_HEADLESS_TOOL_IDS,
  ...BROWSER_TOOL_IDS,
]);

/**
 * The single gate. Every caller that builds a role's tool list — the runner
 * effector today, P5-C's ladder rung next — asks here rather than assembling
 * its own array, so "browser tools are Final-Tester-only" is one fact in one
 * place instead of a convention.
 *
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
 * Browser ids present in `ids`. Empty is the Builder/Tester invariant.
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
