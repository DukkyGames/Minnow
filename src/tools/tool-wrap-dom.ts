/**
 * Locate a rendered tool-call row by its `tool_call_id`.
 *
 * The transcript is rebuilt from history on every chat switch, so any DOM node
 * an in-flight tool batch captured at batch start is stranded the moment the
 * user navigates away and back (MIN-649). `tool_call_id` is the stable identity
 * that survives the rebuild.
 */

/**
 * Escape for a double-quoted attribute selector value.
 *
 * Not `CSS.escape` — that is an identifier escaper, and it is missing from some
 * DOM shims the tests run against.
 */
function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** The live `.tool-call-msg` row for this call, or null when nothing is mounted. */
export function findToolWrapInDom(toolCallId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const id = toolCallId?.trim();
  if (!id) return null;
  return document.querySelector<HTMLElement>(
    `.tool-call-msg[data-tool-call-id="${escapeAttributeValue(id)}"]`,
  );
}
