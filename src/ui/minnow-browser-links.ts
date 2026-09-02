import { HTTP_URL_RE } from './preview-url';

/** Chat transcript roots that receive delegated link routing. */
const CHAT_LINK_ROOT_IDS = [
  'chatArea',
  'desktopChatCol',
  'chatAppMessageCol',
] as const;

let routingBound = false;

/** True when the href should load in the in-app browser instead of an external tab. */
export function isMinnowBrowserUrl(href: string): boolean {
  const trimmed = href.trim();
  return Boolean(trimmed) && HTTP_URL_RE.test(trimmed);
}

/** Open a URL in the Minnow preview panel (Code split or desktop browser drawer). */
export function openUrlInMinnowBrowser(url: string): void {
  const trimmed = url.trim();
  if (!isMinnowBrowserUrl(trimmed)) return;
  void import('./preview-panel').then(({ openUrlInPreviewPanel }) => {
    void openUrlInPreviewPanel(trimmed);
  });
}

function isChatMessageLink(anchor: Element): boolean {
  return Boolean(anchor.closest('.msg-bubble'));
}

function isInsideChatLinkRoot(anchor: Element): boolean {
  for (const id of CHAT_LINK_ROOT_IDS) {
    const root = document.getElementById(id);
    if (root?.contains(anchor)) return true;
  }
  const orchestratePane = anchor.closest('[data-testid="orchestrate-chat-pane"]');
  return orchestratePane !== null;
}

/** Resolve absolute http(s) href from a chat anchor; relative paths are left to the app. */
function resolveMinnowBrowserHref(anchor: Element): string | null {
  const raw = anchor.getAttribute('href')?.trim() ?? '';
  if (!raw || raw.startsWith('#') || raw.toLowerCase().startsWith('javascript:')) {
    return null;
  }
  if (raw.startsWith('//')) {
    try {
      const resolved = new URL(raw, window.location.href).href;
      return isMinnowBrowserUrl(resolved) ? resolved : null;
    } catch {
      return null;
    }
  }
  if (!HTTP_URL_RE.test(raw)) return null;
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
}

/** Intercept chat bubble link activation and open in the preview panel. */
export function handleMinnowBrowserLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented) return;
  if (event.button !== 0 && event.type !== 'auxclick') return;
  if (event.type === 'auxclick' && event.button !== 1) return;

  const target = event.target;
  if (!target || typeof target !== 'object' || !('closest' in target)) return;

  const anchor = (target as Element).closest('a[href]');
  if (!anchor || anchor.tagName !== 'A') return;
  if (!isChatMessageLink(anchor) || !isInsideChatLinkRoot(anchor)) return;

  const href = resolveMinnowBrowserHref(anchor);
  if (!href) return;

  event.preventDefault();
  event.stopPropagation();
  openUrlInMinnowBrowser(href);
}

/** Install capture-phase listeners so chat links never escape to the OS browser. */
export function initMinnowBrowserLinkRouting(): void {
  if (routingBound || typeof document === 'undefined') return;
  routingBound = true;
  document.addEventListener('click', handleMinnowBrowserLinkClick, true);
  document.addEventListener('auxclick', handleMinnowBrowserLinkClick, true);
}

/** Reset module state (tests). */
export function resetMinnowBrowserLinkRoutingForTests(): void {
  routingBound = false;
}
