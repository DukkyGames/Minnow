import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { hoverTooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { fetchLspHover } from '../../lsp/completion-client';
import { offsetToLspPosition } from './lsp-positions';

function hoverContentsToHtml(contents: unknown): string {
  if (contents == null) return '';
  if (typeof contents === 'string') {
    return marked.parse(contents, { async: false }) as string;
  }
  if (Array.isArray(contents)) {
    return contents
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'value' in part) {
          const value = String((part as { value: string }).value ?? '');
          const kind = (part as { kind?: string }).kind;
          if (kind === 'markdown') {
            return marked.parse(value, { async: false }) as string;
          }
          return escapeHtml(value);
        }
        return '';
      })
      .join('<br/>');
  }
  if (typeof contents === 'object' && contents !== null && 'value' in contents) {
    const value = String((contents as { value: string }).value ?? '');
    const kind = (contents as { kind?: string }).kind;
    if (kind === 'markdown') {
      return marked.parse(value, { async: false }) as string;
    }
    return escapeHtml(value);
  }
  return escapeHtml(String(contents));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Hover tooltip extension backed by POST /api/lsp/hover. */
export function lspHoverExtensions(filePath: string): Extension[] {
  return [
    hoverTooltip(async (view, pos) => {
      const lspPos = offsetToLspPosition(view, pos);
      const hover = await fetchLspHover(filePath, lspPos.line, lspPos.character);
      if (!hover?.contents) return null;

      const html = DOMPurify.sanitize(hoverContentsToHtml(hover.contents), {
        USE_PROFILES: { html: true },
      });
      if (!html.trim()) return null;

      return {
        pos,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-lsp-hover';
          dom.innerHTML = html;
          return { dom };
        },
      };
    }),
  ];
}
