/**
 * Shared guard: is the event target a text-entry control where shell shortcuts must not fire.
 */

/** True when focus is in an editable field (input, textarea, select, contenteditable). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}
