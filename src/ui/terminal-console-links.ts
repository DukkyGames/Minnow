/**
 * Console URL links open in the Minnow in-app preview (MIN-290, MIN-378).
 */

import { openUrlInMinnowBrowser } from './minnow-browser-links';

/** Match http(s) URLs in streamed console text (aligned with xterm web-links). */
const CONSOLE_URL_RE = /https?:\/\/[^\s"'<>]+/gi;

/** Open a console link in the preview panel instead of an external tab. */
export function openConsoleLinkInPreview(url: string): void {
  openUrlInMinnowBrowser(url);
}

/** xterm WebLinksAddon handler — route clicks to the preview panel. */
export function handleTerminalWebLink(_event: MouseEvent, uri: string): void {
  openConsoleLinkInPreview(uri);
}

function bindConsoleLinkAnchor(anchor: HTMLAnchorElement, url: string): void {
  anchor.href = url;
  anchor.textContent = url;
  anchor.className = 'terminal-console-link';
  anchor.addEventListener('click', (event) => {
    event.preventDefault();
    openConsoleLinkInPreview(url);
  });
}

/**
 * Append plain or stderr text to a console `<pre>`, turning URLs into preview links.
 */
export function appendConsoleOutputWithLinks(
  parent: HTMLElement,
  text: string,
  options: { stderr?: boolean } = {},
): void {
  if (!text) return;

  const wrapper = options.stderr ? document.createElement('span') : null;
  if (wrapper) {
    wrapper.className = 'stderr-line';
  }

  const target = wrapper ?? parent;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of text.matchAll(CONSOLE_URL_RE)) {
    const url = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
    }
    const anchor = document.createElement('a');
    bindConsoleLinkAnchor(anchor, url);
    fragment.appendChild(anchor);
    lastIndex = index + url.length;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  target.appendChild(fragment);
  if (wrapper) {
    parent.appendChild(wrapper);
  }
}
