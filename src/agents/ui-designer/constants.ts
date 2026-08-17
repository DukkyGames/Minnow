/**
 * UI Designer Work Agent / slash skill constants (Step 15).
 */

export const UI_DESIGNER_AGENT_ID = 'ui-designer';
export const UI_DESIGNER_SKILL_ID = 'ui-designer';

/** Tools permitted for UI Designer turns (restricted allowlist). */
export const UI_DESIGNER_TOOL_ALLOWLIST = [
  'browser_list',
  'browser_navigate',
  'browser_snapshot',
  'browser_screenshot',
  'browser_click',
  'browser_fill',
  'read_file',
  'read_file_range',
  'read_document',
  'search_in_file',
  'replace_text_in_file',
  'save_file',
  'list_directory',
  'load_impeccable_context',
  'run_impeccable',
] as const;

/** File mutation tools blocked in plan mode. */
export const UI_DESIGNER_WRITE_TOOLS = new Set([
  'save_file',
  'replace_text_in_file',
  'browser_click',
  'browser_fill',
]);

export type UiDesignerMode = 'plan' | 'implement';
