/**
 * The finished brief.
 *
 * Findings carry the weight: each leads with its claim, and its citations are
 * live controls that open the cited source in place rather than sending the
 * reader to a list at the bottom. References stay at the foot as a numbered
 * reference list, not a section competing with the findings.
 *
 * Run-level actions (export, discuss, refine) live in the run header, not here.
 */

import type { ParsedBrief, ParsedBriefSource, ParsedFindingBlock } from './parse-brief';
import { parseResearchBrief } from './parse-brief';
import type { ResearchSource } from './types';

export interface ReportViewActions {
  onFollowUp: (query: string) => void;
}

/**
 * Inline markdown the engine actually emits: citation markers, links, bold,
 * italic and code. Citation markers come first so `[3]` is read as a citation
 * rather than the opening of a link.
 */
const INLINE_RE =
  /\[(\d{1,3})\](?!\()|\[([^\]]+)\]\(\s*(<?)([^)\s>]+)\3[^)]*\)|\*\*([^*]+)\*\*|`([^`]+)`|(?<![*\w])\*([^*\n]+)\*(?!\*)/g;

function isSafeHref(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Render one run of inline markdown into `target`. Citation markers become live
 * controls via `makeCite`; anything it declines to build is dropped, because a
 * marker pointing at a source the run never recorded is noise.
 */
function appendInline(
  target: Node,
  text: string,
  makeCite: (n: number) => HTMLElement | null,
): void {
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) {
      target.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    last = match.index + match[0].length;

    const [, citeN, linkLabel, , linkUrl, bold, code, italic] = match;

    if (citeN !== undefined) {
      const cite = makeCite(Number(citeN));
      if (cite) {
        target.appendChild(cite);
      }
      continue;
    }
    if (linkLabel !== undefined) {
      if (isSafeHref(linkUrl)) {
        const a = document.createElement('a');
        a.className = 'rs-link';
        a.href = linkUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = linkLabel;
        target.appendChild(a);
      } else {
        target.appendChild(document.createTextNode(linkLabel));
      }
      continue;
    }
    if (bold !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = bold;
      target.appendChild(strong);
      continue;
    }
    if (code !== undefined) {
      const el = document.createElement('code');
      el.className = 'rs-code';
      el.textContent = code;
      target.appendChild(el);
      continue;
    }
    if (italic !== undefined) {
      const em = document.createElement('em');
      em.textContent = italic;
      target.appendChild(em);
    }
  }

  if (last < text.length) {
    target.appendChild(document.createTextNode(text.slice(last)));
  }
}

/** Render a finding's structured body: subheadings, paragraphs and lists. */
function appendBlocks(
  target: Node,
  blocks: ParsedFindingBlock[],
  makeCite: (n: number) => HTMLElement | null,
): void {
  for (const block of blocks) {
    if (block.kind === 'sub') {
      const sub = document.createElement('h5');
      sub.className = 'rs-finding__sub';
      appendInline(sub, block.text, makeCite);
      target.appendChild(sub);
      continue;
    }
    if (block.kind === 'list') {
      const list = document.createElement('ul');
      list.className = 'rs-finding__list';
      for (const item of block.items) {
        const li = document.createElement('li');
        appendInline(li, item, makeCite);
        list.appendChild(li);
      }
      target.appendChild(list);
      continue;
    }
    const para = document.createElement('p');
    para.className = 'rs-finding__body';
    appendInline(para, block.text, makeCite);
    target.appendChild(para);
  }
}

function sectionLabel(text: string): HTMLElement {
  const h = document.createElement('h3');
  h.className = 'rs-sec';
  h.textContent = text;
  return h;
}

function buildCiteBox(source: ParsedBriefSource, n: number): HTMLElement {
  const box = document.createElement('div');
  box.className = 'rs-citebox';

  const row = document.createElement('div');
  row.className = 'rs-citebox__row';

  const num = document.createElement('span');
  num.className = 'rs-citebox__n';
  num.textContent = String(n);

  const link = document.createElement('a');
  link.className = 'rs-citebox__link';
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = source.title;

  const host = document.createElement('span');
  host.className = 'rs-citebox__host';
  host.textContent = source.host;

  row.append(num, link, host);
  box.appendChild(row);

  if (source.snippet) {
    const snip = document.createElement('p');
    snip.className = 'rs-citebox__snip';
    snip.textContent = source.snippet;
    box.appendChild(snip);
  }

  return box;
}

/** Render the brief body into the mount. */
export function renderResearchReportView(
  mount: HTMLElement,
  brief: ParsedBrief,
  actions: ReportViewActions,
): void {
  const root = document.createElement('div');
  root.className = 'rs-report';

  // Reading column and sources column. They stack on narrow windows and sit
  // side by side once there is room, so the split lives in CSS, not here.
  const main = document.createElement('div');
  main.className = 'rs-report__main';
  const aside = document.createElement('div');
  aside.className = 'rs-report__aside';
  root.append(main, aside);

  if (brief.tldr.trim()) {
    const answer = document.createElement('p');
    answer.className = 'rs-answer';
    answer.textContent = brief.tldr;
    main.appendChild(answer);
  }

  if (brief.findings.length) {
    main.appendChild(sectionLabel('Findings'));
    const list = document.createElement('div');
    list.className = 'rs-findings';

    for (const finding of brief.findings) {
      const article = document.createElement('article');
      article.className = 'rs-finding';

      const claim = document.createElement('h4');
      claim.className = 'rs-finding__claim';
      claim.textContent = finding.heading;

      const box = document.createElement('div');
      box.className = 'rs-citebox';
      box.hidden = true;

      const emitted = new Set<number>();
      const makeCite = (n: number): HTMLElement | null => {
        const source = brief.sources[n - 1];
        if (!source) {
          return null;
        }
        emitted.add(n);
        const cite = document.createElement('button');
        cite.type = 'button';
        cite.className = 'rs-cite';
        cite.textContent = String(n);
        cite.setAttribute('aria-label', `Source ${n}: ${source.title}`);
        cite.addEventListener('click', () => {
          const alreadyOpen = !box.hidden && box.dataset.cite === String(n);
          for (const other of root.querySelectorAll('.rs-cite.is-on')) {
            other.classList.remove('is-on');
          }
          for (const ref of root.querySelectorAll('.rs-ref.is-focus')) {
            ref.classList.remove('is-focus');
          }
          if (alreadyOpen) {
            box.hidden = true;
            box.replaceChildren();
            delete box.dataset.cite;
            return;
          }
          box.replaceChildren(buildCiteBox(source, n));
          box.dataset.cite = String(n);
          box.hidden = false;
          cite.classList.add('is-on');
          const ref = root.querySelector(`.rs-ref[data-ref="${n}"]`);
          ref?.classList.add('is-focus');
          ref?.scrollIntoView({ block: 'nearest' });
        });
        return cite;
      };

      article.appendChild(claim);

      if (finding.blocks?.length) {
        appendBlocks(article, finding.blocks, makeCite);
      } else {
        const body = document.createElement('p');
        body.className = 'rs-finding__body';
        appendInline(body, finding.body, makeCite);
        article.appendChild(body);
      }

      // Markers the engine listed for this finding but never placed in the
      // prose still need a way in, so they trail the last paragraph.
      const orphans = finding.cites.filter((n) => !emitted.has(n));
      if (orphans.length) {
        const tail =
          article.querySelector<HTMLElement>('.rs-finding__body:last-of-type') ?? article;
        for (const n of orphans) {
          const cite = makeCite(n);
          if (cite) {
            tail.appendChild(cite);
          }
        }
      }

      article.appendChild(box);
      list.appendChild(article);
    }
    main.appendChild(list);
  }

  if (brief.followups.length) {
    main.appendChild(sectionLabel('Where next'));
    const follow = document.createElement('div');
    follow.className = 'rs-follow';
    for (const question of brief.followups) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rs-follow__item';
      btn.textContent = question;
      btn.addEventListener('click', () => actions.onFollowUp(question));
      follow.appendChild(btn);
    }
    main.appendChild(follow);
  }

  aside.appendChild(sectionLabel(`References · ${brief.sources.length}`));
  if (brief.sources.length) {
    const refs = document.createElement('div');
    refs.className = 'rs-refs';
    brief.sources.forEach((source, i) => {
      const ref = document.createElement('a');
      ref.className = 'rs-ref';
      ref.dataset.ref = String(i + 1);
      ref.href = source.url;
      ref.target = '_blank';
      ref.rel = 'noopener noreferrer';

      const n = document.createElement('span');
      n.className = 'rs-ref__n';
      n.textContent = String(i + 1);

      const title = document.createElement('span');
      title.className = 'rs-ref__title';
      title.textContent = source.title;

      const host = document.createElement('span');
      host.className = 'rs-ref__host';
      host.textContent = source.host;

      ref.append(n, title, host);
      refs.appendChild(ref);
    });
    aside.appendChild(refs);
  } else {
    const none = document.createElement('p');
    none.className = 'rs-ledger__empty';
    none.textContent = 'This run recorded no sources.';
    aside.appendChild(none);
  }

  mount.replaceChildren(root);
}

/** Parse the markdown report, then render it. */
export function renderResearchResultFromMarkdown(
  mount: HTMLElement,
  markdown: string,
  sources: ResearchSource[],
  query: string,
  actions: ReportViewActions,
): ParsedBrief {
  const brief = parseResearchBrief(markdown, sources, query);
  renderResearchReportView(mount, brief, actions);
  return brief;
}
