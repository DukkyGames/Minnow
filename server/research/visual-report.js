/**
 * Markdown research report → standalone HTML using Minnow palette tokens.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { resolveReportTheme } from './report-theme.js';
import { stripThinking } from './strip-thinking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

marked.setOptions({ gfm: true, breaks: false });

/** nh3 allowlist port — report content is untrusted scraped text. */
const PURIFY_CONFIG = {
  ADD_TAGS: ['details', 'summary'],
  ADD_ATTR: ['target', 'rel', 'id', 'align', 'class'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
};

const GENERIC_HEADINGS = new Set([
  'report', 'deep research report', 'research',
  'executive summary', 'summary', 'tl;dr',
  'introduction', 'overview', 'abstract',
  'findings', 'key findings', 'results',
  'conclusion', 'conclusions', 'table of contents',
  'comparison', 'sources', 'references',
  'suggested follow-ups', 'follow-ups', 'follow ups', 'next steps',
]);

/**
 * Normalize a heading for generic-title comparison (strip parentheticals, lowercase).
 * @param {string} text
 * @returns {string}
 */
function normalizeHeadingForComparison(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Section headings that must not become the report hero title.
 * @param {string} text
 * @returns {boolean}
 */
export function isGenericReportHeading(text) {
  const normalized = normalizeHeadingForComparison(text);
  if (!normalized) {
    return true;
  }
  if (GENERIC_HEADINGS.has(normalized)) {
    return true;
  }
  // TL;DR variants with descriptive parentheticals, e.g. "TL;DR (Executive Summary)"
  if (/^tl;dr\b/.test(normalized)) {
    return true;
  }
  // Suggested follow-ups variants, e.g. "Suggested follow-ups on market gaps"
  if (/^suggested follow[- ]?ups?\b/.test(normalized)) {
    return true;
  }
  return false;
}

const BASE_STYLES = fs.readFileSync(path.join(__dirname, 'visual-report-styles.css'), 'utf8');
const CATEGORY_STYLES = fs.readFileSync(path.join(__dirname, 'visual-report-categories.css'), 'utf8');

const REPORT_SCRIPT = `(function() {
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var menu = document.getElementById('export-menu');
    if (menu && menu.classList.contains('open')) { menu.classList.remove('open'); return; }
    try { window.close(); } catch (err) {}
    setTimeout(function() { if (!window.closed) history.back(); }, 50);
  });

  var exportBtn = document.getElementById('btn-export');
  var exportMenu = document.getElementById('export-menu');
  if (!exportBtn || !exportMenu) return;
  exportBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    exportMenu.classList.toggle('open');
  });
  exportMenu.addEventListener('click', function(e) { e.stopPropagation(); });
  document.addEventListener('click', function() { exportMenu.classList.remove('open'); });

  document.getElementById('btn-pdf').addEventListener('click', function() {
    exportMenu.classList.remove('open');
    window.print();
  });

  document.getElementById('btn-html').addEventListener('click', function() {
    exportMenu.classList.remove('open');
    var blob = new Blob([document.documentElement.outerHTML], { type: 'text/html' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = document.title.replace(/[^a-z0-9]+/gi, '-').substring(0, 60) + '.html';
    a.click();
  });

  var tocLinks = document.querySelectorAll('.toc-sidebar nav a[href^="#"]');
  tocLinks.forEach(function(link) {
    link.addEventListener('click', function(e) {
      var id = link.getAttribute('href').slice(1);
      var target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + id);
    });
  });

  var tocMap = {};
  tocLinks.forEach(function(link) {
    tocMap[link.getAttribute('href').slice(1)] = link;
  });
  var activeId = null;
  function setActive(id) {
    if (id === activeId) return;
    if (activeId && tocMap[activeId]) tocMap[activeId].classList.remove('active');
    if (id && tocMap[id]) tocMap[id].classList.add('active');
    activeId = id;
  }
  var headings = document.querySelectorAll('.content h2[id], .content h3[id]');
  if (headings.length && 'IntersectionObserver' in window) {
    var visible = new Set();
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(en) {
        if (en.isIntersecting) visible.add(en.target.id);
        else visible.delete(en.target.id);
      });
      var current = null;
      for (var i = 0; i < headings.length; i++) {
        if (visible.has(headings[i].id)) { current = headings[i].id; break; }
      }
      if (current) setActive(current);
    }, { rootMargin: '-10% 0px -75% 0px', threshold: 0 });
    headings.forEach(function(h) { io.observe(h); });
  }
})();

if (document.body.classList.contains('category-comparison')) {
  const pos = /^(yes|excellent|best|great|strong|fast|high|superior|winner|free|unlimited|native|full|advanced|built[- ]in|✓|✅|⭐)/i;
  const neg = /^(no|none|poor|weak|slow|low|limited|lacking|missing|basic|minimal|✗|❌|N\\/A$)/i;
  const mid = /^(moderate|average|fair|partial|some|decent|okay|mixed|varies|depends)/i;
  document.querySelectorAll('.content table td').forEach(td => {
    if (td.cellIndex === 0) return;
    const t = td.textContent.trim();
    if (pos.test(t)) td.classList.add('cmp-pos');
    else if (neg.test(t)) td.classList.add('cmp-neg');
    else if (mid.test(t)) td.classList.add('cmp-mid');
  });
}`;

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en" data-theme="{theme_id}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:type" content="article">
{og_image_meta}
<meta name="theme-color" content="{theme_color}">
<meta name="color-scheme" content="{color_scheme}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='75' font-size='75'>M</text></svg>">
<style>
{theme_tokens_css}
{base_styles_css}
{category_styles_css}
</style>
</head>
<body class="{body_class}">

<div class="toolbar">
  {restore_btn_html}
  <div class="dropdown">
    <button id="btn-export" title="Export">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Export &#9662;
    </button>
    <div class="dropdown-menu" id="export-menu">
      <button id="btn-pdf">Save as PDF</button>
      <button id="btn-html">Download HTML</button>
    </div>
  </div>
</div>

<div class="hero">
  <div class="hero-label">Minnow &mdash; Deep Research Report</div>
  <h1>{question_html}</h1>
</div>

{hero_image_html}

<div class="stats-bar">
  {stats_html}
</div>

<div class="layout">
  <aside class="toc-sidebar">
    <nav>
      {toc_html}
    </nav>
  </aside>
  <main class="content">
    {report_html}

    {sources_html}

    {chat_cta_html}
  </main>
</div>

<div class="report-footer">
  Generated by Minnow Deep Research &middot; {timestamp}
</div>

</body>
</html>`;

/** Visual-report style key for normalized categories. */
const CATEGORY_VISUAL_KEYS = {
  technical: 'product',
  academic: 'landscape',
  news: 'factcheck',
  market: 'comparison',
  general: 'landscape',
  product: 'product',
  comparison: 'comparison',
  howto: 'howto',
  factcheck: 'factcheck',
  landscape: 'landscape',
};

/**
 * Convert bare URLs to markdown links (skip URLs already in link syntax).
 * @param {string} mdText
 * @returns {string}
 */
export function autolinkUrls(mdText) {
  if (typeof mdText !== 'string') {
    return mdText;
  }
  return mdText.replace(/(?<!\]\()(?<!\()(https?:\/\/[^\s)<>]+)/g, '[$1]($1)');
}

/**
 * Sanitize rendered report HTML from untrusted markdown/web content.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeReportHtml(html) {
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

/**
 * Markdown → HTML with GFM, external link targets, and sanitization.
 * @param {string} mdText
 * @returns {string}
 */
export function mdToHtml(mdText) {
  const linked = autolinkUrls(mdText);
  let result = marked.parse(linked);
  if (typeof result !== 'string') {
    result = String(result);
  }
  result = result.replace(
    /<a href="(https?:\/\/)/g,
    '<a target="_blank" rel="noopener noreferrer" href="$1',
  );
  return sanitizeReportHtml(result);
}

/**
 * @param {string} text
 * @returns {string}
 */
function plainHeadingText(text) {
  return text
    .trim()
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]+\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]+/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 * @param {Record<string, number>} seenSlugs
 * @returns {string}
 */
function makeSlug(text, seenSlugs) {
  let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) {
    slug = 'section';
  }
  if (seenSlugs[slug] != null) {
    seenSlugs[slug] += 1;
    slug = `${slug}-${seenSlugs[slug]}`;
  } else {
    seenSlugs[slug] = 0;
  }
  return slug;
}

/**
 * Pull h2/h3 headings from markdown for table of contents.
 * @param {string} mdText
 * @returns {Array<{ level: number, text: string, slug: string }>}
 */
export function extractHeadings(mdText) {
  if (typeof mdText !== 'string') {
    return [];
  }
  /** @type {Array<{ level: number, text: string, slug: string }>} */
  const headings = [];
  /** @type {Record<string, number>} */
  const seenSlugs = {};

  for (const m of mdText.matchAll(/^(#{2,3})\s+(.+)$/gm)) {
    const level = m[1].length;
    const text = plainHeadingText(m[2]);
    if (!text) {
      continue;
    }
    headings.push({ level, text, slug: makeSlug(text, seenSlugs) });
  }

  if (!headings.length) {
    for (const m of mdText.matchAll(/^\*\*([^*]+)\*\*\s*$/gm)) {
      const text = plainHeadingText(m[1]).replace(/:$/, '');
      if (text.length > 3 && text.length < 80) {
        headings.push({ level: 2, text, slug: makeSlug(text, seenSlugs) });
      }
    }
  }
  return headings;
}

/**
 * Force rendered h2/h3 IDs to match generated sidebar links.
 * @param {string} reportHtml
 * @param {Array<{ level: number, slug: string }>} headings
 * @returns {string}
 */
export function applyHeadingIds(reportHtml, headings) {
  if (!headings.length) {
    return reportHtml;
  }
  let idx = 0;
  return reportHtml.replace(/<(h[23])(\s[^>]*)?>/gi, (match, tag, attrs = '') => {
    if (idx >= headings.length) {
      return match;
    }
    const heading = headings[idx];
    idx += 1;
    const cleanAttrs = String(attrs).replace(/\s*id="[^"]*"/gi, '');
    return `<${tag}${cleanAttrs} id="${heading.slug}">`;
  });
}

/**
 * Pull a real title from the report's first heading; strip duplicate from body.
 * Only the opening # / ## line may become the hero title — deeper section headings
 * (e.g. Suggested follow-ups) must not be promoted.
 * @param {string} markdownText
 * @param {string} fallback
 * @returns {{ title: string, markdown: string }}
 */
export function extractReportTitle(markdownText, fallback) {
  if (!markdownText) {
    return { title: fallback, markdown: markdownText };
  }

  const re = /^(#{1,2}) +(.+?)\s*$/m;
  const m = re.exec(markdownText);
  if (!m) {
    return { title: fallback, markdown: markdownText };
  }

  const cand = m[2].trim().replace(/#+$/, '').trim();
  const start = m.index ?? 0;
  const end = start + m[0].length;

  if (!cand || isGenericReportHeading(cand)) {
    return { title: fallback, markdown: markdownText };
  }

  const stripped = (markdownText.slice(0, start) + markdownText.slice(end)).trimStart();
  return { title: cand, markdown: stripped };
}

/**
 * Promote bold-only lines to ## headings when no markdown headings exist.
 * @param {string} markdown
 * @returns {string}
 */
export function promoteBoldHeadings(markdown) {
  if (/^#{2,3}\s+/m.test(markdown)) {
    return markdown;
  }
  return markdown.replace(/^\*\*([^*]+)\*\*\s*$/gm, (_m, title) => `## ${String(title).trim()}`);
}

/**
 * @param {string | null | undefined} category
 * @returns {string}
 */
export function normalizeResearchCategory(category) {
  const raw = String(category ?? '').trim().toLowerCase();
  const legacy = {
    product: 'technical',
    comparison: 'market',
    howto: 'technical',
    factcheck: 'news',
  };
  if (!raw) {
    return '';
  }
  if (legacy[raw]) {
    return legacy[raw];
  }
  if (['technical', 'academic', 'news', 'market', 'general'].includes(raw)) {
    return raw;
  }
  return 'general';
}

/**
 * @param {string | null | undefined} category
 * @returns {string}
 */
export function categoryCss(category) {
  void category;
  return CATEGORY_STYLES;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} url
 * @returns {string}
 */
function hostnameFromUrl(url) {
  try {
    let host = new URL(url).hostname || '';
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    return host;
  } catch {
    return url;
  }
}

/**
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function fillTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

/**
 * @typedef {{ url?: string, title?: string, image?: string }} ResearchSource
 * @typedef {{ Duration?: string, Rounds?: number | string, Queries?: number | string, URLs?: number | string, Model?: string, Search?: string }} ResearchStats
 */

/**
 * Generate a self-contained HTML report page styled with Minnow palette tokens.
 * @param {string} question
 * @param {string} reportMarkdown
 * @param {ResearchSource[]} [sources]
 * @param {ResearchStats} [stats]
 * @param {string | null | undefined} [category]
 * @param {string | null | undefined} [researchId]
 * @param {string | null | undefined} [themeId]
 * @param {Record<string, string> | null | undefined} [customTokens]
 * @returns {string}
 */
export function generateVisualReport(
  question,
  reportMarkdown,
  sources = [],
  stats = {},
  category = null,
  researchId = null,
  themeId = null,
  customTokens = null,
) {
  void researchId; // Phase 5b: hero/section images, hide/reroll endpoints

  let markdown = stripThinking(reportMarkdown) ?? '';
  const { title: synthesized, markdown: bodyMarkdown } = extractReportTitle(markdown, question);
  markdown = promoteBoldHeadings(bodyMarkdown);

  let reportHtml = mdToHtml(markdown);
  const headings = extractHeadings(markdown);
  reportHtml = applyHeadingIds(reportHtml, headings);

  if (category === 'product' && headings.length) {
    const productHeadings = headings.filter((h) => h.level === 3);
    if (productHeadings.length) {
      const pills = productHeadings
        .map(
          (h) =>
            `<a href="#${h.slug}" class="quick-link">${escapeHtml(h.text.slice(0, 40))}</a>`,
        )
        .join(' ');
      reportHtml = `<div class="quick-links-bar">${pills}</div>\n${reportHtml}`;
    }
  }

  const tocHtml = headings
    .map(
      (h) =>
        `<a href="#${h.slug}" class="depth-${h.level}">${escapeHtml(h.text)}</a>`,
    )
    .join('\n      ');

  const statLabels = [
    ['Duration', 'Duration'],
    ['Rounds', 'Rounds'],
    ['Queries', 'Queries'],
    ['URLs', 'URLs Analyzed'],
    ['Model', 'Model'],
    ['Search', 'Search'],
  ];
  const statsHtml = statLabels
    .filter(([key]) => stats[key] != null)
    .map(
      ([key, label]) =>
        `<div class="stat"><span class="stat-value">${escapeHtml(String(stats[key]))}</span> ${escapeHtml(label)}</div>`,
    )
    .join('\n  ');

  let sourcesHtml = '';
  if (sources.length) {
    const items = sources.map((s, i) => {
      const url = s.url ?? '';
      const title = escapeHtml(s.title || url);
      const domain = escapeHtml(hostnameFromUrl(url));
      return (
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">` +
        `<span class="snum">${i + 1}.</span>` +
        `<span>${title}</span>` +
        `<span class="sdomain">${domain}</span>` +
        '</a>'
      );
    });
    sourcesHtml =
      '<div class="sources-panel">\n' +
      '<details>\n' +
      `<summary>Sources (${sources.length})</summary>\n` +
      '<div class="sources-list">\n' +
      items.join('\n') +
      '\n</div>\n</details>\n</div>';
  }

  const titleText = synthesized.length > 120 ? `${synthesized.slice(0, 120)}...` : synthesized;
  const descText = markdown.replace(/[#*_[\]()]/g, '').slice(0, 160).trim();
  const timestamp = new Date().toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const normalizedCategory = normalizeResearchCategory(category);
  const visualKey = normalizedCategory
    ? CATEGORY_VISUAL_KEYS[normalizedCategory] ?? normalizedCategory
    : '';
  const bodyClass = visualKey ? `category-${escapeHtml(String(visualKey))}` : '';

  const theme = resolveReportTheme(themeId, customTokens);

  const html = fillTemplate(HTML_TEMPLATE, {
    title: escapeHtml(titleText),
    description: escapeHtml(descText),
    og_image_meta: '<!-- Phase 5b: og:image meta -->',
    question_html: escapeHtml(synthesized),
    hero_image_html: '<!-- Phase 5b: hero image -->',
    stats_html: statsHtml,
    toc_html: tocHtml,
    report_html: reportHtml,
    sources_html: sourcesHtml,
    chat_cta_html: '<!-- Phase 6: Discuss CTA (client-side spinoff) -->',
    restore_btn_html: '<!-- Phase 5b: restore hidden images -->',
    timestamp: escapeHtml(timestamp),
    body_class: bodyClass,
    theme_id: escapeHtml(theme.themeId),
    theme_color: escapeHtml(theme.themeColor),
    color_scheme: theme.colorScheme,
    theme_tokens_css: theme.themeTokensCss,
    base_styles_css: BASE_STYLES,
    category_styles_css: CATEGORY_STYLES,
  });

  return html.replace(
    '</body>',
    `<script>\n${REPORT_SCRIPT}\n</script>\n</body>`,
  );
}
