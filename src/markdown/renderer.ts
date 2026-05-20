import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { marked } from 'marked';
import { ASSISTANT_RENDER_DEBOUNCE_MS } from '../constants';
import {
  assistantRenderDebounceTimer,
  setAssistantRenderDebounceTimer,
} from '../app-state';
import { mountReefWidgets } from '../chat/reef/index.ts';
import { scrollBottom } from '../ui/input';

let minnowMarkedConfigured = false;

export function cancelAssistantBubbleRenderDebounce(): void {
  if (assistantRenderDebounceTimer != null) {
    clearTimeout(assistantRenderDebounceTimer);
    setAssistantRenderDebounceTimer(null);
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
}

/**
 * Render assistant markdown: marked → DOMPurify → highlight.js.
 * When streaming, re-appends the live cursor after innerHTML updates.
 */
export function setAssistantBubbleContent(
  bubble: HTMLElement,
  markdown: string | null | undefined,
  options: AssistantBubbleOptions = {}
): void {
  const streaming = options.streaming === true;
  const streamCursor = options.streamCursor || null;

  bubble.classList.add('msg-bubble--md');

  const raw = markdown == null ? '' : String(markdown);

  if (!raw.trim() && streaming && streamCursor) {
    bubble.textContent = '';
    bubble.appendChild(streamCursor);
    return;
  }

  if (!raw.trim() && !streaming) {
    bubble.innerHTML = '';
    return;
  }

  ensureMarkedOptionsConfigured();

  let html: string;
  try {
    html = marked.parse(raw) as string;
  } catch {
    bubble.textContent = raw;
    if (streaming && streamCursor) bubble.appendChild(streamCursor);
    return;
  }

  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  bubble.innerHTML = clean;

  bubble.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;
    const m = /\blanguage-([\w-]+)\b/.exec(code.className || '');
    if (m) pre.setAttribute('data-lang', m[1]);
    else pre.removeAttribute('data-lang');
  });

  bubble.querySelectorAll('pre code').forEach((block) => {
    try {
      if (!block.classList.contains('hljs')) hljs.highlightElement(block as HTMLElement);
    } catch {
      /* unknown language or partial fence during stream */
    }
  });

  if (streaming && streamCursor) bubble.appendChild(streamCursor);

  mountReefWidgets(bubble);
}

/** Debounced markdown refresh while the assistant reply is still streaming. */
export function scheduleAssistantBubbleRender(
  bubble: HTMLElement,
  markdown: string,
  streamCursor: HTMLElement
): void {
  cancelAssistantBubbleRenderDebounce();
  setAssistantRenderDebounceTimer(
    setTimeout(() => {
      setAssistantRenderDebounceTimer(null);
      setAssistantBubbleContent(bubble, markdown, { streaming: true, streamCursor });
      scrollBottom();
    }, ASSISTANT_RENDER_DEBOUNCE_MS)
  );
}
