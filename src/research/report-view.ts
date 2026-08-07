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

import type { ParsedBrief, ParsedBriefSource } from './parse-brief';
import { parseResearchBrief } from './parse-brief';
import type { ResearchSource } from './types';

export interface ReportViewActions {
  onFollowUp: (query: string) => void;
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

  if (brief.tldr.trim()) {
    const answer = document.createElement('p');
    answer.className = 'rs-answer';
    answer.textContent = brief.tldr;
    root.appendChild(answer);
  }

  if (brief.findings.length) {
    root.appendChild(sectionLabel('Findings'));
    const list = document.createElement('div');
    list.className = 'rs-findings';

    for (const finding of brief.findings) {
      const article = document.createElement('article');
      article.className = 'rs-finding';

      const claim = document.createElement('h4');
      claim.className = 'rs-finding__claim';
      claim.textContent = finding.heading;

      const body = document.createElement('p');
      body.className = 'rs-finding__body';
      body.appendChild(document.createTextNode(finding.body));

      const box = document.createElement('div');
      box.className = 'rs-citebox';
      box.hidden = true;

      for (const n of finding.cites) {
        const source = brief.sources[n - 1];
        if (!source) {
          continue;
        }
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
          root.querySelector(`.rs-ref[data-ref="${n}"]`)?.classList.add('is-focus');
        });
        body.appendChild(cite);
      }

      article.append(claim, body, box);
      list.appendChild(article);
    }
    root.appendChild(list);
  }

  if (brief.followups.length) {
    root.appendChild(sectionLabel('Where next'));
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
    root.appendChild(follow);
  }

  root.appendChild(sectionLabel(`References · ${brief.sources.length}`));
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
    root.appendChild(refs);
  } else {
    const none = document.createElement('p');
    none.className = 'rs-ledger__empty';
    none.textContent = 'This run recorded no sources.';
    root.appendChild(none);
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
