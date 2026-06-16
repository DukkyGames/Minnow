/**
 * Safe HTML rendering for email message bodies in the reading pane.
 */

import DOMPurify from 'dompurify';
import type { EmailMessage } from '../../email/client';

const EMAIL_PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'rel'],
  FORBID_TAGS: [
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'style',
    'link',
    'base',
    'meta',
    'svg',
    'math',
    'frame',
    'frameset',
    'applet',
    'portal',
  ],
};

type BodySource = Pick<EmailMessage, 'bodyHtml' | 'bodyText' | 'bodyPreview'>;

/** Harden external links opened from formatted mail bodies. */
function secureLinks(root: HTMLElement): void {
  root.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    const lower = href.trim().toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:')) {
      anchor.removeAttribute('href');
      return;
    }
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });
}

/**
 * Render a message body into the reading pane (HTML when available, else plain text).
 */
export function renderEmailBody(mount: HTMLElement, message: BodySource): void {
  mount.replaceChildren();
  const html = message.bodyHtml?.trim();

  if (html) {
    mount.classList.add('html-body');
    const clean = DOMPurify.sanitize(html, EMAIL_PURIFY_CONFIG);
    mount.innerHTML = clean;
    secureLinks(mount);
    return;
  }

  mount.classList.remove('html-body');
  mount.textContent = message.bodyText ?? message.bodyPreview ?? '';
}
