/**
 * Shared highlight.js instance: core build + common chat/doc languages.
 * Rare grammars load the full package once as a separate lazy chunk (vendor-highlight).
 */

import hljs from 'highlight.js/lib/core';
import type { HLJSApi } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('r', r);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('plaintext', plaintext);

// Fence labels models often emit (ts/js/md/cs/tsx) map onto registered grammars.
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases('js', { languageName: 'javascript' });
hljs.registerAliases('md', { languageName: 'markdown' });
hljs.registerAliases('cs', { languageName: 'csharp' });

let fullBundle: Promise<HLJSApi> | null = null;

/** Full highlight.js bundle — only pulled when a fence uses an unregistered language. */
function loadFullHighlightJs(): Promise<HLJSApi> {
  if (!fullBundle) {
    fullBundle = import('highlight.js').then((mod) => mod.default);
  }
  return fullBundle;
}

function languageFromCodeElement(el: HTMLElement): string | null {
  const match = /\blanguage-([\w-]+)\b/.exec(el.className || '');
  return match?.[1] ?? null;
}

function coreSupportsLanguage(lang: string): boolean {
  return Boolean(hljs.getLanguage(lang));
}

/** Highlight one `<code>` block; falls back to the lazy full bundle when needed. */
export async function highlightCodeElement(block: HTMLElement): Promise<void> {
  const lang = languageFromCodeElement(block);
  if (lang && !coreSupportsLanguage(lang)) {
    try {
      const full = await loadFullHighlightJs();
      full.highlightElement(block);
    } catch {}
    return;
  }
  try {
    hljs.highlightElement(block);
  } catch {
    try {
      const full = await loadFullHighlightJs();
      full.highlightElement(block);
    } catch {}
  }
}

/** Re-run highlight.js on fenced blocks so class-based colors match the active stylesheet. */
export function refreshHljsInDocument(): void {
  document.querySelectorAll('pre code.hljs').forEach((block) => {
    const el = block as HTMLElement;
    const plain = el.textContent ?? '';
    el.removeAttribute('data-highlighted');
    el.classList.remove('hljs');
    el.textContent = plain;
    void highlightCodeElement(el);
  });
}
