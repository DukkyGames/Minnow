/**
 * Map a lossy attempt transcript (TurnEvent JSONL) onto the API-message shape
 * `renderTranscriptView` already understands.
 *
 * Boards keep their own log rows. The drawer paints assistant / tool_call /
 * tool_result messages. One mapper so those two views cannot invent a second
 * event vocabulary. Pure: no I/O, no journal.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function argsString(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '{}';
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

/**
 * Last assistant row, walking backward past tool results.
 *
 * @param {unknown[]} messages
 * @returns {{ index: number, row: Record<string, unknown> } | null}
 */
function lastAssistant(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const raw = messages[i];
    if (!raw || typeof raw !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    if (row.role === 'assistant') return { index: i, row };
  }
  return null;
}

/**
 * True when coalesced `thinking` may rewrite this assistant row's `reasoning`.
 * Only empty, tool-free stubs are open carriers — once the row has tool_calls
 * or visible prose, later thinking is a new turn and must append after tools.
 *
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function canAttachThinking(row) {
  const toolCalls = row.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return false;
  if (row.content == null) return true;
  if (typeof row.content === 'string') return row.content.trim() === '';
  return false;
}

/**
 * True when any assistant row already has visible prose (not a tool-call stub).
 *
 * @param {unknown[]} messages
 * @returns {boolean}
 */
function hasAssistantProse(messages) {
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    if (row.role !== 'assistant') continue;
    const toolCalls = row.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) continue;
    const text = typeof row.content === 'string' ? row.content.trim() : '';
    if (text) return true;
  }
  return false;
}

/**
 * Last tool_call id that does not yet have a matching tool row.
 *
 * @param {unknown[]} messages
 * @returns {string}
 */
function lastOpenToolCallId(messages) {
  /** @type {Set<string>} */
  const answered = new Set();
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    if (row.role === 'tool' && typeof row.tool_call_id === 'string') {
      answered.add(row.tool_call_id);
    }
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const raw = messages[i];
    if (!raw || typeof raw !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    if (row.role !== 'assistant' || !Array.isArray(row.tool_calls)) continue;
    for (let j = row.tool_calls.length - 1; j >= 0; j -= 1) {
      const tc = row.tool_calls[j];
      const id =
        tc && typeof tc === 'object' && typeof /** @type {Record<string, unknown>} */ (tc).id === 'string'
          ? /** @type {{ id: string }} */ (tc).id
          : '';
      if (id && !answered.has(id)) return id;
    }
  }
  return '';
}

/**
 * Apply one recorded TurnEvent onto an API-message list.
 *
 * High-frequency types (`delta`, `phase`, …) are ignored here — they never
 * land on disk, and live overlays handle them separately. Coalesced
 * `thinking` and `attempt_end.summary` do land on disk and must hydrate
 * into Activity; otherwise a reasoning-only or delta-only turn paints empty.
 *
 * @param {unknown[]} messages
 * @param {unknown} event
 * @returns {unknown[]}
 */
export function applyTurnEventToMessages(messages, event) {
  const list = Array.isArray(messages) ? messages : [];
  if (!event || typeof event !== 'object') return list;
  const rec = /** @type {Record<string, unknown>} */ (event);
  const type = typeof rec.type === 'string' ? rec.type : '';

  if (type === 'tool_call') {
    const name = typeof rec.name === 'string' && rec.name ? rec.name : 'tool';
    const id =
      typeof rec.id === 'string' && rec.id
        ? rec.id
        : `call_${name}_${list.length}`;
    return [
      ...list,
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id,
            type: 'function',
            function: { name, arguments: argsString(rec.arguments) },
          },
        ],
      },
    ];
  }

  if (type === 'tool_result') {
    const id =
      typeof rec.id === 'string' && rec.id ? rec.id : lastOpenToolCallId(list);
    if (!id) return list;
    return [
      ...list,
      {
        role: 'tool',
        tool_call_id: id,
        content: typeof rec.content === 'string' ? rec.content : '',
      },
    ];
  }

  if (type === 'round_end') {
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!text) return list;
    return [...list, { role: 'assistant', content: text }];
  }

  // Coalesced on disk: rewrite the open reasoning stub, or start a new row.
  // Never attach post-tool thinking onto a tool_calls assistant — that painted
  // later Thoughts above the tools that already ran.
  if (type === 'thinking') {
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!text) return list;
    const found = lastAssistant(list);
    if (found && canAttachThinking(found.row)) {
      const next = list.slice();
      next[found.index] = { ...found.row, reasoning: text };
      return next;
    }
    return [...list, { role: 'assistant', content: '', reasoning: text }];
  }

  // Effector writes this after the attempt; use it only when no later prose exists.
  if (type === 'attempt_end') {
    const summary = typeof rec.summary === 'string' ? rec.summary.trim() : '';
    if (!summary) return list;
    if (hasAssistantProse(list)) return list;
    const found = lastAssistant(list);
    if (found) {
      const toolCalls = found.row.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        const next = list.slice();
        next[found.index] = { ...found.row, content: summary };
        return next;
      }
    }
    return [...list, { role: 'assistant', content: summary }];
  }

  return list;
}

/**
 * Fold a transcript's events into API messages for the drawer.
 *
 * @param {unknown[]} events
 * @returns {unknown[]}
 */
export function turnEventsToMessages(events) {
  /** @type {unknown[]} */
  let messages = [];
  if (!Array.isArray(events)) return messages;
  for (const event of events) {
    messages = applyTurnEventToMessages(messages, event);
  }
  return messages;
}

/**
 * Count nested tool invocations from API-shaped messages.
 *
 * @param {unknown[]} messages
 * @returns {number}
 */
export function countToolCalls(messages) {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    if (row.role === 'assistant' && Array.isArray(row.tool_calls)) {
      n += row.tool_calls.length;
    }
  }
  return n;
}
