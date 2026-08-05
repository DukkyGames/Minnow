/**
 * Assistant markdown rendering: marked → DOMPurify → highlight.js.
 *
 * Streaming path is incremental (O(n) amortized): only dirty trailing tokens are
 * re-parsed/sanitized/highlighted. Non-streaming callers keep a one-shot
 * marked.parse + innerHTML fast path.
 */

import DOMPurify from 'dompurify';
import { marked, type Token } from 'marked';
import { highlightCodeElement } from './highlighter';
import { ASSISTANT_RENDER_DEBOUNCE_MS } from '../constants';
import {
  assistantRenderDebounceTimer,
  setAssistantRenderDebounceTimer,
} from '../app-state';
import { announceStreamingProse } from '../ui/a11y/stream-announcer';
import { scrollBottom } from '../ui/input';

let minnowMarkedConfigured = false;

/** Per-bubble incremental render state (WeakMap so detached bubbles GC cleanly). */
interface RenderState {
  /** FNV-1a of each committed token's `raw` — hashes, not raw, to avoid O(n) memory. */
  signatures: number[];
  /** DOM nodes produced per token (space tokens may yield zero nodes). */
  nodes: Node[][];
  /** Per-bubble debounce timer — concurrent board streams must not cancel each other. */
  timer: ReturnType<typeof setTimeout> | null;
}

const renderStateByBubble = new WeakMap<HTMLElement, RenderState>();
/** Strong refs for bubbles with an active debounce timer (cancel-all needs iteration). */
const bubblesWithActiveTimer = new Set<HTMLElement>();

function getRenderState(bubble: HTMLElement): RenderState {
  let state = renderStateByBubble.get(bubble);
  if (!state) {
    state = { signatures: [], nodes: [], timer: null };
    renderStateByBubble.set(bubble, state);
  }
  return state;
}

/** FNV-1a 32-bit — cheap stable hash of token.raw for dirty detection. */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clearBubbleTimer(bubble: HTMLElement, state: RenderState): void {
  if (state.timer != null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  bubblesWithActiveTimer.delete(bubble);
}

/**
 * Cancel debounced streaming renders.
 * Pass a bubble to cancel only that bubble; omit to cancel every active timer
 * (existing chat.ts / loop.ts call sites).
 */
export function cancelAssistantBubbleRenderDebounce(bubble?: HTMLElement): void {
  if (bubble) {
    const state = renderStateByBubble.get(bubble);
    if (state) clearBubbleTimer(bubble, state);
    return;
  }
  if (assistantRenderDebounceTimer != null) {
    clearTimeout(assistantRenderDebounceTimer);
    setAssistantRenderDebounceTimer(null);
  }
  for (const b of [...bubblesWithActiveTimer]) {
    const state = renderStateByBubble.get(b);
    if (state) clearBubbleTimer(b, state);
  }
}

/** Configure marked once for GitHub-flavored markdown without single-line breaks. */
function ensureMarkedOptionsConfigured(): void {
  if (minnowMarkedConfigured) return;
  minnowMarkedConfigured = true;
  try {
    if (typeof marked.use === 'function') {
      marked.use({ gfm: true, breaks: false });
      return;
    }
    if (typeof (marked as { setOptions?: (o: object) => void }).setOptions === 'function') {
      (marked as { setOptions: (o: object) => void }).setOptions({ gfm: true, breaks: false });
    }
  } catch {
    /* Some builds differ; defaults are usually acceptable for chat. */
  }
}

export interface AssistantBubbleOptions {
  streaming?: boolean;
  streamCursor?: HTMLElement | null;
  modeId?: string;
}

/** Apply data-lang attributes on `<pre>` from fenced code class names. */
function applyDataLangAttributes(root: ParentNode): void {
  root.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;
    const m = /\blanguage-([\w-]+)\b/.exec(code.className || '');
    if (m) pre.setAttribute('data-lang', m[1]);
    else pre.removeAttribute('data-lang');
  });
}

/** Highlight code blocks under root; optionally skip the last unfinished fence. */
function highlightCodeBlocks(
  root: ParentNode,
  options: { skipUnterminatedFinalFence?: boolean; finalToken?: Token | null } = {},
): void {
  const { skipUnterminatedFinalFence = false, finalToken = null } = options;
  const skipFinal =
    skipUnterminatedFinalFence &&
    finalToken != null &&
    finalToken.type === 'code' &&
    !/```\s*$/.test(finalToken.raw ?? '');

  const blocks = root.querySelectorAll('pre code');
  blocks.forEach((block, index) => {
    if (skipFinal && index === blocks.length - 1) return;
    if (!block.classList.contains('hljs')) {
      void highlightCodeElement(block as HTMLElement);
    }
  });
}

/** Reset incremental bookkeeping after a destructive full replace. */
function resetIncrementalState(bubble: HTMLElement): void {
  const state = getRenderState(bubble);
  state.signatures = [];
  state.nodes = [];
}

/** One-shot full render (non-streaming / final flush) — same cost as the pre-Phase-5 path. */
function renderFull(
  bubble: HTMLElement,
  raw: string,
  streaming: boolean,
  streamCursor: HTMLElement | null,
): void {
  ensureMarkedOptionsConfigured();

  let html: string;
  try {
    html = marked.parse(raw) as string;
  } catch {
    bubble.textContent = raw;
    if (streaming && streamCursor) bubble.appendChild(streamCursor);
    resetIncrementalState(bubble);
    return;
  }

  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  bubble.innerHTML = clean;
  applyDataLangAttributes(bubble);
  highlightCodeBlocks(bubble);

  if (streaming && streamCursor) bubble.appendChild(streamCursor);
  resetIncrementalState(bubble);
}

/**
 * Incremental streaming render: lex whole string, reuse unchanged prefix DOM,
 * re-parse only from the first dirty token (always including the growing last block).
 */
function renderIncremental(
  bubble: HTMLElement,
  raw: string,
  streamCursor: HTMLElement | null,
): void {
  ensureMarkedOptionsConfigured();
  const state = getRenderState(bubble);

  let tokens: Token[];
  try {
    tokens = marked.lexer(raw) as Token[];
  } catch {
    renderFull(bubble, raw, true, streamCursor);
    return;
  }

  // Find first signature mismatch; last token is always dirty mid-stream.
  let dirtyFrom = 0;
  const limit = Math.min(tokens.length, state.signatures.length);
  while (dirtyFrom < limit) {
    if (fnv1a32(tokens[dirtyFrom]!.raw ?? '') !== state.signatures[dirtyFrom]) break;
    dirtyFrom += 1;
  }
  if (tokens.length === 0) {
    dirtyFrom = 0;
  } else {
    // Clamp so the growing final token is always rebuilt.
    dirtyFrom = Math.min(dirtyFrom, tokens.length - 1);
  }

  // Drop DOM for dirty suffix.
  for (let i = dirtyFrom; i < state.nodes.length; i++) {
    for (const node of state.nodes[i] ?? []) {
      node.parentNode?.removeChild(node);
    }
  }
  state.nodes.length = dirtyFrom;
  state.signatures.length = dirtyFrom;

  // Detach stream cursor before appending so it is not duplicated.
  if (streamCursor?.parentNode) streamCursor.remove();

  const fragment = document.createDocumentFragment();
  const newNodeGroups: Node[][] = [];

  for (let i = dirtyFrom; i < tokens.length; i++) {
    const token = tokens[i]!;
    let html: string;
    try {
      html = marked.parser([token]) as string;
    } catch {
      html = '';
    }
    // Wrap before sanitize: DOMPurify can drop a lone block root (`<h2>`, `<ul>`, …)
    // when the dirty string is a single element; a throwaway wrapper keeps structure.
    const wrapped = html.trim() ? `<div data-mn-md-wrap>${html}</div>` : '';
    const cleanWrapped = DOMPurify.sanitize(wrapped, { USE_PROFILES: { html: true } });
    const template = document.createElement('template');
    template.innerHTML = cleanWrapped;
    const wrapEl = template.content.querySelector('[data-mn-md-wrap]');
    const sourceRoot: ParentNode = wrapEl ?? template.content;
    // Keep text nodes too — DOMPurify often unwraps `<p>` to mixed text+inline children.
    const children = Array.from(sourceRoot.childNodes).filter((n) => {
      if (n.nodeType === 1) return true;
      if (n.nodeType === 3) return (n.textContent ?? '').length > 0;
      return false;
    });
    for (const child of children) {
      fragment.appendChild(child);
    }
    newNodeGroups.push(children);
    state.signatures.push(fnv1a32(token.raw ?? ''));
  }

  applyDataLangAttributes(fragment);
  highlightCodeBlocks(fragment, {
    skipUnterminatedFinalFence: true,
    finalToken: tokens[tokens.length - 1] ?? null,
  });

  bubble.appendChild(fragment);
  for (const group of newNodeGroups) {
    state.nodes.push(group);
  }

  if (streamCursor) bubble.appendChild(streamCursor);
}

/**
 * Render assistant markdown: marked → DOMPurify → highlight.js.
 * When streaming, re-appends the live cursor after updates and uses incremental DOM.
 */
export function setAssistantBubbleContent(
  bubble: HTMLElement,
  markdown: string | null | undefined,
  options: AssistantBubbleOptions = {},
): void {
  const streaming = options.streaming === true;
  const streamCursor = options.streamCursor || null;

  bubble.classList.add('msg-bubble--md');

  const raw = markdown == null ? '' : String(markdown);

  if (!raw.trim() && streaming && streamCursor) {
    bubble.textContent = '';
    bubble.appendChild(streamCursor);
    resetIncrementalState(bubble);
    return;
  }

  if (!raw.trim() && !streaming) {
    bubble.innerHTML = '';
    resetIncrementalState(bubble);
    return;
  }

  // Streaming: incremental O(n). Non-streaming: one-shot parse (unchanged call-site contract).
  if (streaming) {
    renderIncremental(bubble, raw, streamCursor);
    return;
  }

  renderFull(bubble, raw, false, null);
}

/** Debounced markdown refresh while the assistant reply is still streaming. */
export function scheduleAssistantBubbleRender(
  bubble: HTMLElement,
  markdown: string,
  streamCursor: HTMLElement,
): void {
  const state = getRenderState(bubble);
  clearBubbleTimer(bubble, state);

  const timer = setTimeout(() => {
    state.timer = null;
    bubblesWithActiveTimer.delete(bubble);
    if (assistantRenderDebounceTimer === timer) {
      setAssistantRenderDebounceTimer(null);
    }
    setAssistantBubbleContent(bubble, markdown, { streaming: true, streamCursor });
    announceStreamingProse(markdown);
    scrollBottom();
  }, ASSISTANT_RENDER_DEBOUNCE_MS);

  state.timer = timer;
  bubblesWithActiveTimer.add(bubble);
  // Legacy global tracks the most recent schedule so cancel-all without a bubble still works
  // for single-chat streams that never migrated to the bubble param.
  setAssistantRenderDebounceTimer(timer);
}

/** Test helper — read incremental state for a bubble. */
export function getAssistantBubbleRenderStateForTests(bubble: HTMLElement): {
  signatureCount: number;
  nodeGroupCount: number;
  firstNode: Node | null;
} {
  const state = renderStateByBubble.get(bubble);
  return {
    signatureCount: state?.signatures.length ?? 0,
    nodeGroupCount: state?.nodes.length ?? 0,
    firstNode: state?.nodes[0]?.[0] ?? null,
  };
}
