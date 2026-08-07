/**
 * Parse markdown research reports into structured brief sections for in-app display.
 */

import type { ResearchSource } from './types';
import { inferSourceType } from './progress-panel';

/**
 * A finding body keeps its shape. Engines write subheadings, lists and several
 * paragraphs under one finding; flattening that into a single string is what
 * made reports render as a wall of text with stray `####` in the middle of it.
 * Block text keeps its inline markdown so the view can turn links and citation
 * markers into real controls.
 */
export type ParsedFindingBlock =
  | { kind: 'para'; text: string }
  | { kind: 'sub'; text: string }
  | { kind: 'list'; items: string[] };

export interface ParsedFinding {
  heading: string;
  /** Flat, markdown-stripped text. Kept for previews and search. */
  body: string;
  /** Structured body. Absent only for briefs built by older callers. */
  blocks?: ParsedFindingBlock[];
  cites: number[];
}

export interface ParsedBriefSource {
  url: string;
  title: string;
  host: string;
  type: string;
  /** Excerpt the engine captured, when it captured one. */
  snippet: string;
}

export interface ParsedBrief {
  title: string;
  tldr: string;
  findings: ParsedFinding[];
  followups: string[];
  sources: ParsedBriefSource[];
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 48);
  }
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function extractCites(text: string): number[] {
  const cites: number[] = [];
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && !cites.includes(n)) {
      cites.push(n);
    }
  }
  return cites;
}

function sectionBody(lines: string[], start: number, end: number): string {
  return lines
    .slice(start, end)
    .join('\n')
    .trim();
}

/** Group a finding's raw lines into paragraphs, subheadings and lists. */
function buildBlocks(rawLines: string[]): ParsedFindingBlock[] {
  const blocks: ParsedFindingBlock[] = [];
  let para: string[] = [];
  let items: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ kind: 'para', text: para.join(' ') });
      para = [];
    }
  };
  const flushList = (): void => {
    if (items.length) {
      blocks.push({ kind: 'list', items });
      items = [];
    }
  };

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const sub = line.match(/^#{4,6}\s+(.+)/);
    if (sub) {
      flushPara();
      flushList();
      blocks.push({ kind: 'sub', text: sub[1].trim().replace(/[:*]+$/, '') });
      continue;
    }
    const item = line.match(/^(?:[-*+]|\d+\.)\s+(.+)/);
    if (item) {
      flushPara();
      items.push(item[1].trim());
      continue;
    }
    flushList();
    para.push(line);
  }

  flushPara();
  flushList();
  return blocks;
}

function makeFinding(heading: string, rawLines: string[]): ParsedFinding {
  const joined = rawLines.join('\n');
  return {
    heading,
    body: stripMarkdownInline(
      rawLines
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' '),
    ),
    blocks: buildBlocks(rawLines),
    cites: extractCites(joined),
  };
}

function findSectionIndex(lines: string[], patterns: RegExp[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (patterns.some((re) => re.test(line))) {
      return i;
    }
  }
  return -1;
}

/** Parse markdown + API sources into a structured research brief. */
export function parseResearchBrief(
  markdown: string,
  sources: ResearchSource[],
  fallbackTitle: string,
): ParsedBrief {
  const text = markdown.trim();
  const lines = text.split('\n');

  let title = fallbackTitle.trim() || 'Research Brief';
  const h1 = lines.find((l) => /^#\s+/.test(l.trim()));
  if (h1) {
    title = stripMarkdownInline(h1.replace(/^#\s+/, ''));
  }

  const tldrIdx = findSectionIndex(lines, [
    /^##\s+tl;?dr/i,
    /^##\s+executive summary/i,
    /^##\s+summary/i,
  ]);
  const findingsIdx = findSectionIndex(lines, [/^##\s+key findings/i, /^##\s+findings/i]);
  const followIdx = findSectionIndex(lines, [
    /^##\s+suggested follow-ups/i,
    /^##\s+follow-up/i,
    /^##\s+next steps/i,
  ]);
  const sourcesIdx = findSectionIndex(lines, [/^##\s+sources/i, /^##\s+references/i]);
  const conclusionIdx = findSectionIndex(lines, [/^##\s+conclusion/i]);

  const sectionEnds = [findingsIdx, followIdx, sourcesIdx, conclusionIdx, lines.length].filter(
    (n) => n >= 0,
  );
  const firstEnd = sectionEnds.length ? Math.min(...sectionEnds.filter((n) => n > tldrIdx)) : lines.length;

  let tldr = '';
  if (tldrIdx >= 0) {
    const end = firstEnd > tldrIdx ? firstEnd : lines.length;
    tldr = stripMarkdownInline(sectionBody(lines, tldrIdx + 1, end));
  } else {
    const firstPara = lines.find((l) => l.trim() && !l.trim().startsWith('#'));
    tldr = firstPara ? stripMarkdownInline(firstPara) : stripMarkdownInline(text.slice(0, 600));
  }

  const findings: ParsedFinding[] = [];
  if (findingsIdx >= 0) {
    const end =
      [followIdx, sourcesIdx, conclusionIdx, lines.length]
        .filter((n) => n > findingsIdx)
        .sort((a, b) => a - b)[0] ?? lines.length;
    const block = lines.slice(findingsIdx + 1, end);
    let heading: string | null = null;
    let raw: string[] = [];

    const commit = (): void => {
      if (heading !== null) {
        findings.push(makeFinding(heading, raw));
      }
    };

    for (const line of block) {
      const h3 = line.match(/^###\s+(.+)/);
      if (h3) {
        commit();
        heading = stripMarkdownInline(h3[1]);
        raw = [];
        continue;
      }
      if (heading !== null) {
        raw.push(line);
      }
    }
    commit();
  }

  if (!findings.length) {
    const h2Sections: ParsedFinding[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/^##\s+(.+)/);
      if (!m) {
        continue;
      }
      const heading = stripMarkdownInline(m[1]);
      if (/^(tl;?dr|executive summary|summary|sources|references|conclusion|suggested)/i.test(heading)) {
        continue;
      }
      const bodyLines: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^##\s+/.test(lines[j])) {
          break;
        }
        bodyLines.push(lines[j]);
      }
      const finding = makeFinding(heading, bodyLines);
      if (finding.body) {
        h2Sections.push(finding);
      }
    }
    findings.push(...h2Sections.slice(0, 6));
  }

  const followups: string[] = [];
  if (followIdx >= 0) {
    const end =
      [sourcesIdx, conclusionIdx, lines.length]
        .filter((n) => n > followIdx)
        .sort((a, b) => a - b)[0] ?? lines.length;
    for (const line of lines.slice(followIdx + 1, end)) {
      const bullet = line.match(/^[-*]\s+(.+)/);
      const numbered = line.match(/^\d+\.\s+(.+)/);
      const q = bullet?.[1] ?? numbered?.[1];
      if (q) {
        followups.push(stripMarkdownInline(q));
      }
    }
  }

  const parsedSources: ParsedBriefSource[] = sources.map((s, i) => {
    const url = s.url?.trim() || '';
    const titleText = s.title?.trim() || url || `Source ${i + 1}`;
    const snippet = s.snippet?.trim() ?? '';
    return {
      url,
      title: titleText,
      host: hostFromUrl(url),
      type: inferSourceType(url),
      snippet,
    };
  });

  return {
    title,
    tldr: tldr.slice(0, 1200),
    findings: findings.slice(0, 8),
    followups: followups.slice(0, 5),
    sources: parsedSources,
  };
}
