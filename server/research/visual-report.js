/**
 * Markdown research report → standalone editorial HTML page (text-only v1).
 * Port of Odysseus `src/visual_report.py` — CSS template verbatim; OG images deferred to Phase 5b.
 */

import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { stripThinking } from './strip-thinking.js';

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
]);

const HTML_TEMPLATE = "\n<!DOCTYPE html>\r\n<html lang=\"en\">\r\n<head>\r\n<meta charset=\"utf-8\">\r\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\r\n<title>{title}</title>\r\n<meta name=\"description\" content=\"{description}\">\r\n<meta property=\"og:title\" content=\"{title}\">\r\n<meta property=\"og:description\" content=\"{description}\">\r\n<meta property=\"og:type\" content=\"article\">\r\n{og_image_meta}\r\n<meta name=\"theme-color\" content=\"#b8543a\" media=\"(prefers-color-scheme: light)\">\r\n<meta name=\"theme-color\" content=\"#131214\" media=\"(prefers-color-scheme: dark)\">\r\n<link rel=\"icon\" href=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='75' font-size='75'>O</text></svg>\">\r\n<style>\r\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\r\n\r\n:root {\r\n  --font-display: 'Charter', 'Iowan Old Style', Georgia, serif;\r\n  --font-body: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\r\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\r\n  --bg: #fbf9f4;\r\n  --bg-surface: #ffffff;\r\n  --bg-surface-alt: #f1ede4;\r\n  --border: rgba(0,0,0,0.08);\r\n  --border-strong: rgba(0,0,0,0.16);\r\n  --text: #1a1817;\r\n  --text-dim: #5a5651;\r\n  --text-muted: #8a8580;\r\n  --accent: #b8543a;\r\n  --accent-light: #d97a5e;\r\n  --accent-bg: rgba(184,84,58,0.06);\r\n  --gold: #c9952e;\r\n  --gold-bg: rgba(201,149,46,0.09);\r\n  --aurora-a: rgba(184,84,58,0.10);\r\n  --aurora-b: rgba(201,149,46,0.08);\r\n  --aurora-c: rgba(64,98,128,0.07);\r\n  --radius: 12px;\r\n  --shadow-sm: 0 1px 3px rgba(0,0,0,0.05);\r\n  --shadow-md: 0 4px 24px rgba(0,0,0,0.07);\r\n  --max-w: 760px;\r\n}\r\n\r\n@media (prefers-color-scheme: dark) {\r\n  :root {\r\n    --bg: #131214; --bg-surface: #1c1a1e; --bg-surface-alt: #25232a;\r\n    --border: rgba(255,255,255,0.07); --border-strong: rgba(255,255,255,0.16);\r\n    --text: #ece8e2; --text-dim: #a8a39c; --text-muted: #6f6b66;\r\n    --accent: #e88f73; --accent-light: #f4ad95; --accent-bg: rgba(232,143,115,0.09);\r\n    --gold: #e8c05a; --gold-bg: rgba(232,192,90,0.09);\r\n    --aurora-a: rgba(232,143,115,0.13);\r\n    --aurora-b: rgba(232,192,90,0.09);\r\n    --aurora-c: rgba(125,180,224,0.10);\r\n    --shadow-sm: 0 1px 3px rgba(0,0,0,0.4); --shadow-md: 0 4px 28px rgba(0,0,0,0.55);\r\n  }\r\n}\r\n\r\nhtml {\r\n  scroll-behavior: smooth;\r\n  /* Give smooth-scroll some breathing room so anchors land below the\r\n     fixed toolbar instead of being shoved straight under it. */\r\n  scroll-padding-top: 4rem;\r\n}\r\nbody {\r\n  font-family: var(--font-body);\r\n  background: var(--bg);\r\n  color: var(--text);\r\n  line-height: 1.75;\r\n  font-size: 17px;\r\n  font-feature-settings: 'ss01', 'cv11';\r\n  -webkit-font-smoothing: antialiased;\r\n  text-rendering: optimizeLegibility;\r\n  position: relative;\r\n  min-height: 100vh;\r\n}\r\n\r\n/* ── Aurora background ─────────────────────────────────\r\n   Slowly-drifting layered blobs in the accent palette. Sits behind\r\n   the content, fixed to the viewport so scrolling doesn't reset the\r\n   composition. Subtle grain on top stops it reading as 'flat CSS'. */\r\nbody::before {\r\n  content: '';\r\n  position: fixed;\r\n  inset: -20vh -20vw;\r\n  z-index: -2;\r\n  background:\r\n    radial-gradient(40vw 50vh at 18% 22%, var(--aurora-a) 0%, transparent 60%),\r\n    radial-gradient(45vw 55vh at 82% 12%, var(--aurora-b) 0%, transparent 65%),\r\n    radial-gradient(55vw 60vh at 50% 88%, var(--aurora-c) 0%, transparent 70%);\r\n  filter: blur(20px);\r\n  animation: aurora-drift 28s ease-in-out infinite alternate;\r\n  pointer-events: none;\r\n}\r\nbody::after {\r\n  content: '';\r\n  position: fixed;\r\n  inset: 0;\r\n  z-index: -1;\r\n  pointer-events: none;\r\n  /* Subtle film-grain — SVG turbulence baked to a data-URL. */\r\n  background-image: url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.32 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\");\r\n  opacity: 0.045;\r\n  mix-blend-mode: overlay;\r\n}\r\n@keyframes aurora-drift {\r\n  0%   { transform: translate3d(0,0,0) scale(1);     }\r\n  50%  { transform: translate3d(2vw,-1vh,0) scale(1.04); }\r\n  100% { transform: translate3d(-1vw,1.5vh,0) scale(1.02); }\r\n}\r\n@media (prefers-reduced-motion: reduce) {\r\n  body::before { animation: none; }\r\n}\r\n\r\n/* ── Toolbar (top-right) ──────────────────────────── */\r\n.toolbar {\r\n  position: fixed;\r\n  top: 1rem;\r\n  right: 1rem;\r\n  z-index: 100;\r\n  display: flex;\r\n  gap: 0.4rem;\r\n  opacity: 0.7;\r\n  transition: opacity 0.2s;\r\n}\r\n.toolbar:hover { opacity: 1; }\r\n.toolbar button {\r\n  display: inline-flex;\r\n  align-items: center;\r\n  gap: 5px;\r\n  padding: 6px 14px;\r\n  border: 1px solid var(--border-strong);\r\n  border-radius: 8px;\r\n  background: var(--bg-surface);\r\n  color: var(--text);\r\n  font-family: inherit;\r\n  font-size: 0.78rem;\r\n  font-weight: 500;\r\n  cursor: pointer;\r\n  box-shadow: var(--shadow-sm);\r\n  transition: background 0.15s;\r\n  position: relative;\r\n}\r\n.toolbar button:hover { background: var(--bg-surface-alt); }\r\n.toolbar button svg { width: 14px; height: 14px; flex-shrink: 0; }\r\n.toolbar .toast {\r\n  position: absolute;\r\n  top: calc(100% + 6px);\r\n  right: 0;\r\n  background: var(--text);\r\n  color: var(--bg);\r\n  padding: 4px 10px;\r\n  border-radius: 6px;\r\n  font-size: 0.72rem;\r\n  white-space: nowrap;\r\n  opacity: 0;\r\n  transition: opacity 0.15s;\r\n  pointer-events: none;\r\n}\r\n.toolbar .toast.show { opacity: 1; }\r\n.dropdown { position: relative; }\r\n.dropdown-menu {\r\n  display: none;\r\n  position: absolute;\r\n  top: calc(100% + 4px);\r\n  right: 0;\r\n  background: var(--bg-surface);\r\n  border: 1px solid var(--border-strong);\r\n  border-radius: 8px;\r\n  box-shadow: var(--shadow-md);\r\n  overflow: hidden;\r\n  min-width: 140px;\r\n}\r\n.dropdown-menu.open { display: block; }\r\n.dropdown-menu button {\r\n  display: block;\r\n  width: 100%;\r\n  padding: 8px 14px;\r\n  border: none;\r\n  background: none;\r\n  color: var(--text);\r\n  font-family: inherit;\r\n  font-size: 0.8rem;\r\n  text-align: left;\r\n  cursor: pointer;\r\n}\r\n.dropdown-menu button:hover { background: var(--bg-surface-alt); }\r\n\r\n/* ── Hero ──────────────────────────────────────────── */\r\n.hero {\r\n  position: relative;\r\n  background: transparent;\r\n  color: var(--text);\r\n  padding: 5.5rem 2rem 2.5rem;\r\n  text-align: center;\r\n  overflow: hidden;\r\n}\r\n.hero::before {\r\n  content: '';\r\n  position: absolute;\r\n  inset: 0;\r\n  background:\r\n    radial-gradient(ellipse 70% 60% at 50% 40%, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 70%);\r\n  pointer-events: none;\r\n}\r\n/* A hair-thin gradient hairline divider under the hero to anchor it\r\n   without putting it on a heavy boxed background. */\r\n.hero::after {\r\n  content: '';\r\n  position: absolute;\r\n  left: 50%; bottom: 0;\r\n  width: min(60%, 320px);\r\n  height: 1px;\r\n  transform: translateX(-50%);\r\n  background: linear-gradient(90deg, transparent, var(--border-strong), transparent);\r\n}\r\n.hero-label {\r\n  position: relative;\r\n  text-transform: uppercase;\r\n  letter-spacing: 0.28em;\r\n  font-size: 0.68rem;\r\n  font-weight: 600;\r\n  color: var(--accent);\r\n  opacity: 0.85;\r\n  margin-bottom: 1.4rem;\r\n  font-family: var(--font-body);\r\n}\r\n.hero h1 {\r\n  position: relative;\r\n  font-family: var(--font-display);\r\n  font-size: clamp(2rem, 4.5vw, 3rem);\r\n  font-weight: 600;\r\n  font-variation-settings: 'opsz' 120, 'SOFT' 50;\r\n  line-height: 1.15;\r\n  max-width: 720px;\r\n  margin: 0 auto;\r\n  letter-spacing: -0.02em;\r\n  color: var(--text);\r\n}\r\n\r\n/* ── Hero image ───────────────────────────────────── */\r\n.hero-image {\r\n  max-width: var(--max-w);\r\n  margin: -2rem auto 0;\r\n  position: relative;\r\n  z-index: 1;\r\n  padding: 0 2rem;\r\n}\r\n.hero-image img {\r\n  width: 100%;\r\n  max-height: 360px;\r\n  object-fit: cover;\r\n  border-radius: var(--radius);\r\n  box-shadow: var(--shadow-md);\r\n  display: block;\r\n}\r\n\r\n/* ── Section images ───────────────────────────────── */\r\n.section-image {\r\n  margin: 1.5rem 0;\r\n  position: relative;\r\n}\r\n.section-image img {\r\n  width: 100%;\r\n  max-height: 300px;\r\n  object-fit: cover;\r\n  border-radius: var(--radius);\r\n  box-shadow: var(--shadow-sm);\r\n  display: block;\r\n}\r\n\r\n/* ── Per-image hide button ────────────────────────────\r\n   A small X that appears on hover (or always on touch) so users can\r\n   remove irrelevant OG images. Click POSTs the URL to the backend so\r\n   the next render skips it. */\r\n.img-hide-btn {\r\n  position: absolute;\r\n  top: 10px; right: 10px;\r\n  width: 28px; height: 28px;\r\n  display: inline-flex; align-items: center; justify-content: center;\r\n  background: rgba(0,0,0,0.55);\r\n  color: #fff;\r\n  border: none;\r\n  border-radius: 50%;\r\n  cursor: pointer;\r\n  opacity: 0;\r\n  transition: opacity 0.15s ease, background 0.15s ease, transform 0.05s ease;\r\n  z-index: 2;\r\n  padding: 0;\r\n}\r\n.hero-image .img-hide-btn { top: 14px; right: 2.5rem; }\r\n/* Reroll sits just to the left of the hide button. */\r\n.img-reroll-btn {\r\n  position: absolute;\r\n  top: 10px; right: 46px;\r\n  width: 28px; height: 28px;\r\n  display: inline-flex; align-items: center; justify-content: center;\r\n  background: rgba(0,0,0,0.55);\r\n  color: #fff;\r\n  border: none;\r\n  border-radius: 50%;\r\n  cursor: pointer;\r\n  opacity: 0;\r\n  transition: opacity 0.15s ease, background 0.15s ease, transform 0.05s ease;\r\n  z-index: 2;\r\n  padding: 0;\r\n}\r\n.hero-image .img-reroll-btn { top: 14px; right: calc(2.5rem + 36px); }\r\n.section-image:hover .img-hide-btn,\r\n.section-image:hover .img-reroll-btn,\r\n.hero-image:hover .img-hide-btn,\r\n.hero-image:hover .img-reroll-btn { opacity: 1; }\r\n.img-hide-btn:hover { background: var(--accent); }\r\n.img-reroll-btn:hover { background: var(--accent); }\r\n.img-hide-btn:active,\r\n.img-reroll-btn:active { transform: scale(0.92); }\r\n.img-reroll-btn.spinning svg { animation: img-reroll-spin 0.6s linear infinite; }\r\n.img-reroll-btn:disabled { display: none; }\r\n@keyframes img-reroll-spin { to { transform: rotate(360deg); } }\r\n@media (hover: none) {\r\n  /* Touch devices have no hover — show the buttons at low opacity always. */\r\n  .img-hide-btn, .img-reroll-btn { opacity: 0.7; }\r\n}\r\n.section-image.fading,\r\n.hero-image.fading {\r\n  opacity: 0;\r\n  transform: scale(0.96);\r\n  transition: opacity 0.25s ease, transform 0.25s ease;\r\n}\r\n\r\n/* ── Stats bar ─────────────────────────────────────── */\r\n.stats-bar {\r\n  display: flex;\r\n  justify-content: center;\r\n  gap: 1.5rem;\r\n  flex-wrap: wrap;\r\n  padding: 0.9rem 2rem;\r\n  background: var(--bg-surface);\r\n  border-bottom: 1px solid var(--border);\r\n  font-size: 0.82rem;\r\n  color: var(--text-dim);\r\n}\r\n.stat { display: flex; align-items: center; gap: 0.35rem; }\r\n.stat-value { font-weight: 600; color: var(--text); }\r\n\r\n/* ── Layout ────────────────────────────────────────── */\r\n.layout {\r\n  display: grid;\r\n  grid-template-columns: 200px 1fr;\r\n  max-width: calc(var(--max-w) + 260px);\r\n  margin: 0 auto;\r\n}\r\n@media (max-width: 900px) {\r\n  .layout { grid-template-columns: 1fr; }\r\n  .toc-sidebar { display: none; }\r\n}\r\n\r\n/* ── TOC sidebar ───────────────────────────────────── */\r\n.toc-sidebar {\r\n  position: sticky; top: 0; height: 100vh; overflow-y: auto;\r\n  padding: 3.2rem 0.8rem 2rem 1.4rem;\r\n  border-right: 1px solid var(--border);\r\n  font-size: 0.78rem;\r\n}\r\n.toc-sidebar nav { position: relative; }\r\n.toc-sidebar nav a {\r\n  position: relative;\r\n  display: block;\r\n  color: var(--text-dim);\r\n  text-decoration: none;\r\n  padding: 0.42rem 0.7rem 0.42rem 0.85rem;\r\n  margin: 1px 0;\r\n  border-radius: 6px;\r\n  line-height: 1.4;\r\n  letter-spacing: -0.005em;\r\n  transition: color 0.18s ease, background 0.18s ease, padding-left 0.18s ease;\r\n}\r\n/* Sliding accent indicator on the left edge of each TOC link */\r\n.toc-sidebar nav a::before {\r\n  content: '';\r\n  position: absolute;\r\n  left: 0; top: 50%;\r\n  width: 2px; height: 0;\r\n  background: var(--accent);\r\n  transform: translateY(-50%);\r\n  border-radius: 1px;\r\n  transition: height 0.18s ease, opacity 0.18s ease;\r\n  opacity: 0;\r\n}\r\n.toc-sidebar nav a:hover {\r\n  color: var(--text);\r\n  background: var(--accent-bg);\r\n  padding-left: 1rem;\r\n}\r\n.toc-sidebar nav a:hover::before {\r\n  height: 60%;\r\n  opacity: 1;\r\n}\r\n.toc-sidebar nav a.active {\r\n  color: var(--accent);\r\n  font-weight: 600;\r\n  background: var(--accent-bg);\r\n}\r\n.toc-sidebar nav a.active::before {\r\n  height: 80%;\r\n  opacity: 1;\r\n}\r\n.toc-sidebar nav a.depth-3 {\r\n  padding-left: 1.3rem;\r\n  font-size: 0.72rem;\r\n  color: var(--text-muted);\r\n}\r\n.toc-sidebar nav a.depth-3:hover { padding-left: 1.45rem; }\r\n\r\n/* ── Content ───────────────────────────────────────── */\r\n.content { max-width: var(--max-w); padding: 3rem 2.5rem 4rem; }\r\n\r\n/* Display headings — Fraunces optical-size driven so they get more\r\n   contrast and personality at the larger end. */\r\n.content h2 {\r\n  font-family: var(--font-display);\r\n  font-size: clamp(1.55rem, 2.4vw, 1.85rem);\r\n  font-weight: 600;\r\n  font-variation-settings: 'opsz' 96, 'SOFT' 50;\r\n  margin: 3rem 0 1rem;\r\n  padding-bottom: 0.55rem;\r\n  border-bottom: 1px solid transparent;\r\n  border-image: linear-gradient(90deg, var(--accent) 0%, transparent 65%) 1;\r\n  letter-spacing: -0.022em;\r\n  line-height: 1.2;\r\n  color: var(--text);\r\n}\r\n.content h2:first-child { margin-top: 0; }\r\n.content h3 {\r\n  font-family: var(--font-display);\r\n  font-size: 1.22rem;\r\n  font-weight: 600;\r\n  font-variation-settings: 'opsz' 32;\r\n  margin: 2.2rem 0 0.6rem;\r\n  letter-spacing: -0.015em;\r\n  color: var(--text);\r\n}\r\n.content h4 {\r\n  font-family: var(--font-body);\r\n  font-size: 0.78rem;\r\n  font-weight: 700;\r\n  text-transform: uppercase;\r\n  letter-spacing: 0.12em;\r\n  color: var(--text-dim);\r\n  margin: 1.6rem 0 0.5rem;\r\n}\r\n.content p { margin-bottom: 1.1rem; hanging-punctuation: first last; }\r\n\r\n/* Drop cap on the very first paragraph of the body — old-school editorial\r\n   touch that anchors the reader. */\r\n.content > p:first-of-type::first-letter,\r\n.content > h2:first-child + p::first-letter {\r\n  font-family: var(--font-display);\r\n  font-weight: 700;\r\n  font-variation-settings: 'opsz' 144;\r\n  font-size: 3.6em;\r\n  line-height: 0.85;\r\n  float: left;\r\n  margin: 0.15em 0.12em 0 -0.04em;\r\n  color: var(--accent);\r\n}\r\n\r\n.content a {\r\n  color: var(--accent);\r\n  text-decoration: underline;\r\n  text-decoration-color: color-mix(in srgb, var(--accent) 35%, transparent);\r\n  text-decoration-thickness: 1.5px;\r\n  text-underline-offset: 3px;\r\n  transition: text-decoration-color 0.15s, color 0.15s;\r\n}\r\n.content a:hover {\r\n  text-decoration-color: var(--accent);\r\n  color: var(--accent-light);\r\n}\r\n.content ul, .content ol { margin: 0 0 1.1rem 1.6rem; }\r\n.content li { margin-bottom: 0.4rem; }\r\n.content li::marker { color: var(--accent); }\r\n.content li > ul, .content li > ol { margin-top: 0.4rem; margin-bottom: 0; }\r\n.content blockquote {\r\n  position: relative;\r\n  border-left: 3px solid var(--gold);\r\n  background: var(--gold-bg);\r\n  padding: 1.1rem 1.4rem 1.1rem 2.6rem;\r\n  margin: 1.5rem 0;\r\n  border-radius: 0 var(--radius) var(--radius) 0;\r\n  color: var(--text);\r\n  font-family: var(--font-display);\r\n  font-style: italic;\r\n  font-size: 1.05rem;\r\n  line-height: 1.55;\r\n}\r\n.content blockquote::before {\r\n  content: '\\\\201C';\r\n  position: absolute;\r\n  left: 0.5rem; top: 0.3rem;\r\n  font-family: var(--font-display);\r\n  font-size: 3rem;\r\n  font-style: normal;\r\n  color: var(--gold);\r\n  opacity: 0.5;\r\n  line-height: 1;\r\n}\r\n.content hr { border: none; height: 1px; background: linear-gradient(90deg, transparent, var(--border-strong), transparent); margin: 2rem 0; }\r\n.content code { font-family: var(--font-mono); font-size: 0.86em; background: var(--bg-surface-alt); padding: 0.15em 0.4em; border-radius: 4px; }\r\n.content pre { background: var(--bg-surface-alt); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.25rem 1.5rem; overflow-x: auto; margin: 1.25rem 0; font-size: 0.86rem; line-height: 1.6; }\r\n.content pre code { background: none; padding: 0; }\r\n.content table { width: 100%; border-collapse: collapse; margin: 1.25rem 0; font-size: 0.9rem; border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-sm); }\r\n.content th { text-align: left; padding: 0.7rem 1rem; background: var(--accent-bg); font-weight: 600; border-bottom: 2px solid var(--border-strong); }\r\n.content td { padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); vertical-align: top; }\r\n.content tr:last-child td { border-bottom: none; }\r\n.content tr:hover td { background: var(--accent-bg); }\r\n\r\n/* ── Sources (collapsible list) ───────────────────── */\r\n.sources-panel { margin-top: 3rem; border-top: 2px solid var(--border); padding-top: 1.5rem; }\r\n.sources-panel details { margin: 0; }\r\n.sources-panel summary {\r\n  display: flex; align-items: center; gap: 0.5rem;\r\n  cursor: pointer; font-size: 1rem; font-weight: 600;\r\n  color: var(--text); padding: 0.5rem 0; list-style: none;\r\n  user-select: none;\r\n}\r\n.sources-panel summary::-webkit-details-marker { display: none; }\r\n.sources-panel summary::before {\r\n  content: '\\\\25B6'; font-size: 0.65em; color: var(--text-muted);\r\n  transition: transform 0.2s;\r\n}\r\n.sources-panel details[open] summary::before { transform: rotate(90deg); }\r\n.sources-list { padding: 0.5rem 0 0 0.25rem; }\r\n.sources-list a {\r\n  display: flex; align-items: baseline; gap: 0.5rem;\r\n  padding: 0.35rem 0; font-size: 0.85rem;\r\n  color: var(--text); text-decoration: none;\r\n  transition: color 0.15s;\r\n}\r\n.sources-list a:hover { color: var(--accent); }\r\n.sources-list .snum {\r\n  color: var(--text-muted); font-size: 0.75rem;\r\n  min-width: 1.5rem; text-align: right; flex-shrink: 0;\r\n}\r\n.sources-list .sdomain {\r\n  color: var(--text-muted); font-size: 0.75rem;\r\n  margin-left: auto; flex-shrink: 0;\r\n}\r\n\r\n/* ── Chat-about CTA ────────────────────────────────── */\r\n.chat-cta {\r\n  margin: 3rem 0 1rem; padding: 1.5rem;\r\n  text-align: center;\r\n  border: 1px solid var(--border); border-radius: 12px;\r\n  background: var(--bg-surface);\r\n}\r\n.chat-cta-btn {\r\n  display: inline-flex; align-items: center; gap: 8px;\r\n  padding: 10px 18px; font-size: 0.95rem; font-weight: 600;\r\n  background: var(--accent); color: #fff;\r\n  border: none; border-radius: 8px; cursor: pointer;\r\n  font-family: inherit;\r\n  transition: filter 0.15s, transform 0.05s;\r\n}\r\n.chat-cta-btn:hover:not(:disabled) { filter: brightness(1.1); }\r\n.chat-cta-btn:active:not(:disabled) { transform: translateY(1px); }\r\n.chat-cta-btn:disabled { opacity: 0.6; cursor: progress; }\r\n.chat-cta-hint {\r\n  margin-top: 8px; font-size: 0.8rem; color: var(--text-muted);\r\n}\r\n\r\n/* ── Footer ────────────────────────────────────────── */\r\n.report-footer {\r\n  text-align: center; padding: 2rem; font-size: 0.75rem;\r\n  color: var(--text-muted); border-top: 1px solid var(--border); margin-top: 2rem;\r\n}\r\n\r\n/* ── Animations ────────────────────────────────────── */\r\n@media (prefers-reduced-motion: no-preference) {\r\n  .content h2, .content h3, .content p, .content ul, .content ol,\r\n  .content blockquote, .content table, .content pre, .section-image {\r\n    animation: fadeUp 0.4s ease both;\r\n  }\r\n  @keyframes fadeUp {\r\n    from { opacity: 0; transform: translateY(8px); }\r\n    to   { opacity: 1; transform: translateY(0); }\r\n  }\r\n}\r\n\r\n/* ── Print ─────────────────────────────────────────── */\r\n@media print {\r\n  .toc-sidebar, .toolbar { display: none !important; }\r\n  .layout { grid-template-columns: 1fr; }\r\n  .hero { -webkit-print-color-adjust: exact; print-color-adjust: exact; }\r\n}\r\n{category_css}\r\n</style>\r\n</head>\r\n<body class=\"{body_class}\">\r\n\r\n<!-- Toolbar: Export + Restore hidden images -->\r\n<div class=\"toolbar\">\r\n  {restore_btn_html}\r\n  <div class=\"dropdown\">\r\n    <button id=\"btn-export\" title=\"Export\">\r\n      <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"/></svg>\r\n      Export &#9662;\r\n    </button>\r\n    <div class=\"dropdown-menu\" id=\"export-menu\">\r\n      <button id=\"btn-pdf\">Save as PDF</button>\r\n      <button id=\"btn-html\">Download HTML</button>\r\n    </div>\r\n  </div>\r\n</div>\r\n\r\n<div class=\"hero\">\r\n  <div class=\"hero-label\">Minnow &mdash; Deep Research Report</div>\r\n  <h1>{question_html}</h1>\r\n</div>\r\n\r\n{hero_image_html}\r\n\r\n<div class=\"stats-bar\">\r\n  {stats_html}\r\n</div>\r\n\r\n<div class=\"layout\">\r\n  <aside class=\"toc-sidebar\">\r\n    <nav>\r\n      {toc_html}\r\n    </nav>\r\n  </aside>\r\n  <main class=\"content\">\r\n    {report_html}\r\n\r\n    {sources_html}\r\n\r\n    {chat_cta_html}\r\n  </main>\r\n</div>\r\n\r\n<div class=\"report-footer\">\r\n  Generated by Minnow Deep Research &middot; {timestamp}\r\n</div>\r\n\r\n</body>\r\n</html>\r";

const CATEGORY_PALETTES = "/* ── Category palettes ───────────────────────────────────\r\n   Override the accent + aurora vars per category so each report\r\n   type has a distinct visual identity. */\r\nbody.category-product {\r\n  --accent: #2a8a8c;\r\n  --accent-light: #4ab0b2;\r\n  --accent-bg: rgba(42,138,140,0.07);\r\n  --aurora-a: rgba(42,138,140,0.11);\r\n  --aurora-b: rgba(201,149,46,0.06);\r\n  --aurora-c: rgba(64,98,128,0.06);\r\n}\r\nbody.category-comparison {\r\n  --accent: #7a4cb8;\r\n  --accent-light: #9d76d0;\r\n  --accent-bg: rgba(122,76,184,0.07);\r\n  --aurora-a: rgba(122,76,184,0.11);\r\n  --aurora-b: rgba(184,84,58,0.05);\r\n  --aurora-c: rgba(64,98,128,0.07);\r\n}\r\nbody.category-howto {\r\n  --accent: #3d8a3d;\r\n  --accent-light: #62b162;\r\n  --accent-bg: rgba(61,138,61,0.07);\r\n  --aurora-a: rgba(61,138,61,0.11);\r\n  --aurora-b: rgba(201,149,46,0.07);\r\n  --aurora-c: rgba(42,138,140,0.05);\r\n}\r\nbody.category-landscape {\r\n  --accent: #b88a2e;\r\n  --accent-light: #d4a955;\r\n  --accent-bg: rgba(184,138,46,0.08);\r\n  --aurora-a: rgba(184,138,46,0.13);\r\n  --aurora-b: rgba(184,84,58,0.06);\r\n  --aurora-c: rgba(122,76,184,0.05);\r\n}\r\n@media (prefers-color-scheme: dark) {\r\n  body.category-product {\r\n    --accent: #5cc8cb; --accent-light: #8fdde0;\r\n    --accent-bg: rgba(92,200,203,0.10);\r\n    --aurora-a: rgba(92,200,203,0.13);\r\n    --aurora-b: rgba(232,192,90,0.07);\r\n    --aurora-c: rgba(125,180,224,0.08);\r\n  }\r\n  body.category-comparison {\r\n    --accent: #b896e8; --accent-light: #d0b8f0;\r\n    --accent-bg: rgba(184,150,232,0.10);\r\n    --aurora-a: rgba(184,150,232,0.13);\r\n    --aurora-b: rgba(232,143,115,0.06);\r\n    --aurora-c: rgba(125,180,224,0.08);\r\n  }\r\n  body.category-howto {\r\n    --accent: #82c882; --accent-light: #a8dba8;\r\n    --accent-bg: rgba(130,200,130,0.09);\r\n    --aurora-a: rgba(130,200,130,0.12);\r\n    --aurora-b: rgba(232,192,90,0.07);\r\n    --aurora-c: rgba(92,200,203,0.07);\r\n  }\r\n  body.category-landscape {\r\n    --accent: #e6c069; --accent-light: #f0d390;\r\n    --accent-bg: rgba(230,192,105,0.10);\r\n    --aurora-a: rgba(230,192,105,0.15);\r\n    --aurora-b: rgba(232,143,115,0.07);\r\n    --aurora-c: rgba(184,150,232,0.06);\r\n  }\r\n}\r\n\r\n/* ── Per-category font pairings ───────────────────────\r\n   Body font shifts between serif (long-form categories) and sans\r\n   (practical/data categories) so each report reads as a different\r\n   publication, not just a re-tinted version of the same template. */\r\n\r\n/* Long-form: literary serif for both display and body */\r\nbody:not([class*=\"category-\"]),\r\nbody.category-landscape {\r\n  --font-body: 'Source Serif 4', 'Iowan Old Style', Georgia, serif;\r\n}\r\n\r\n/* Comparison: analytical serif display + clean sans body */\r\nbody.category-comparison {\r\n  --font-display: 'Playfair Display', Georgia, serif;\r\n  --font-body: 'Inter', system-ui, sans-serif;\r\n}\r\n\r\n/* How-to: friendly geometric sans, top to bottom */\r\nbody.category-howto {\r\n  --font-display: 'Manrope', system-ui, sans-serif;\r\n  --font-body: 'Inter', system-ui, sans-serif;\r\n}\r\n\r\n/* Product: techy/engineery — IBM Plex Sans display + Inter body */\r\nbody.category-product {\r\n  --font-display: 'IBM Plex Sans', system-ui, sans-serif;\r\n  --font-body: 'Inter', system-ui, sans-serif;\r\n}\r\n\r\n/* Source Serif sits visually larger than Inter at the same px — pull it\r\n   back one notch for the categories that use it as body so line length\r\n   and rhythm stay comparable across categories. */\r\nbody:not([class*=\"category-\"]) body, /* no-op selector, kept for clarity */\r\nbody.category-landscape { font-size: 16.5px; }\r\n\r\n/* Drop cap looks bad on geometric sans — kill it for those categories */\r\nbody.category-product   .content > p:first-of-type::first-letter,\r\nbody.category-howto     .content > p:first-of-type::first-letter,\r\nbody.category-comparison .content > p:first-of-type::first-letter,\r\nbody.category-product   .content > h2:first-child + p::first-letter,\r\nbody.category-howto     .content > h2:first-child + p::first-letter,\r\nbody.category-comparison .content > h2:first-child + p::first-letter {\r\n  font-size: 1em; float: none; margin: 0; color: inherit;\r\n  font-family: inherit; font-weight: inherit;\r\n}\r\n\r\n/* ── Per-category background effects ───────────────\r\n   Each category overrides body::before so the page reads as a\r\n   distinctly-textured surface. Aurora stays the default. */\r\n\r\n/* Product → blueprint grid that slowly pans */\r\nbody.category-product::before {\r\n  background:\r\n    linear-gradient(to right, var(--aurora-a) 1px, transparent 1px),\r\n    linear-gradient(to bottom, var(--aurora-a) 1px, transparent 1px),\r\n    radial-gradient(70vw 60vh at 50% 50%, var(--aurora-a) 0%, transparent 75%);\r\n  background-size: 56px 56px, 56px 56px, 100% 100%;\r\n  filter: none;\r\n  animation: cat-grid-pan 60s linear infinite;\r\n}\r\n@keyframes cat-grid-pan {\r\n  to { background-position: 56px 56px, 56px 56px, 0 0; }\r\n}\r\n\r\n/* Comparison → dot grid + slow opacity pulse */\r\nbody.category-comparison::before {\r\n  background:\r\n    radial-gradient(circle, var(--aurora-a) 1.4px, transparent 1.8px),\r\n    radial-gradient(60vw 55vh at 25% 25%, var(--aurora-b) 0%, transparent 65%),\r\n    radial-gradient(60vw 55vh at 75% 75%, var(--aurora-c) 0%, transparent 65%);\r\n  background-size: 26px 26px, 100% 100%, 100% 100%;\r\n  filter: none;\r\n  animation: cat-dot-pulse 14s ease-in-out infinite alternate;\r\n}\r\n@keyframes cat-dot-pulse {\r\n  from { opacity: 0.65; }\r\n  to   { opacity: 1; }\r\n}\r\n\r\n/* How-to → flat surface with a very subtle vignette. Drop the flow-lines\r\n   pattern — it competes visually with the step number rails on the\r\n   right-hand side of each H2. The reading should feel like an O'Reilly\r\n   procedure: clean, scannable, no decoration in the way. */\r\nbody.category-howto::before {\r\n  background:\r\n    radial-gradient(70vw 70vh at 50% 0%, var(--aurora-a) 0%, transparent 60%),\r\n    radial-gradient(50vw 50vh at 50% 100%, var(--aurora-b) 0%, transparent 65%);\r\n  filter: blur(40px);\r\n  animation: none;\r\n}\r\n\r\n/* Landscape → horizontal horizon bands that slowly shift sideways */\r\nbody.category-landscape::before {\r\n  background:\r\n    linear-gradient(\r\n      180deg,\r\n      transparent 0%,\r\n      var(--aurora-a) 22%,\r\n      transparent 35%,\r\n      var(--aurora-b) 55%,\r\n      transparent 68%,\r\n      var(--aurora-c) 85%,\r\n      transparent 100%\r\n    );\r\n  background-size: 100% 200%;\r\n  filter: blur(40px);\r\n  animation: cat-horizon-drift 36s ease-in-out infinite alternate;\r\n}\r\n@keyframes cat-horizon-drift {\r\n  0%   { background-position: 0 0; }\r\n  100% { background-position: 0 100%; }\r\n}\r\n\r\n@media (prefers-reduced-motion: reduce) {\r\n  body.category-product::before,\r\n  body.category-comparison::before,\r\n  body.category-howto::before,\r\n  body.category-landscape::before {\r\n    animation: none;\r\n  }\r\n}\r\n\r\n/* ─────────────────────────────────────────────────────\r\n   PER-CATEGORY STRUCTURAL TREATMENTS\r\n   Each category gets distinctive structural CSS so the page\r\n   reads as a different publication — not just retinted.\r\n   ───────────────────────────────────────────────────── */\r\n\r\n/* ── HOWTO: O'Reilly-style numbered procedure ─────── */\r\nbody.category-howto .content { counter-reset: howto-step; }\r\nbody.category-howto .content h2 {\r\n  counter-increment: howto-step;\r\n  display: flex; align-items: center; gap: 14px;\r\n  border-bottom: none;\r\n  padding-left: 0;\r\n  margin-top: 3.5rem;\r\n}\r\nbody.category-howto .content h2::before {\r\n  content: counter(howto-step);\r\n  display: inline-flex; align-items: center; justify-content: center;\r\n  flex-shrink: 0;\r\n  width: 40px; height: 40px;\r\n  border-radius: 12px;\r\n  background: var(--accent);\r\n  color: #fff;\r\n  font-family: var(--font-display);\r\n  font-size: 1.15rem;\r\n  font-weight: 700;\r\n  letter-spacing: 0;\r\n  box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);\r\n}\r\n/* Step body gets a colored left rail so you can scan \"this is step 1's stuff\" */\r\nbody.category-howto .content h2 ~ p,\r\nbody.category-howto .content h2 ~ ul,\r\nbody.category-howto .content h2 ~ ol,\r\nbody.category-howto .content h2 ~ pre,\r\nbody.category-howto .content h2 ~ blockquote {\r\n  border-left: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);\r\n  padding-left: 1rem;\r\n  margin-left: 4px;\r\n}\r\nbody.category-howto .content h2:has(+ *) ~ h2 ~ * { border-left: none; padding-left: 0; margin-left: 0; }\r\n/* Terminal-style code blocks — green $ prompt, monospaced, dark surface */\r\nbody.category-howto .content pre {\r\n  background: #1a1a1e;\r\n  color: #d4e4d4;\r\n  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);\r\n  border-radius: 8px;\r\n  position: relative;\r\n  padding-left: 2.6rem;\r\n}\r\nbody.category-howto .content pre::before {\r\n  content: '$';\r\n  position: absolute;\r\n  left: 1.1rem; top: 1.15rem;\r\n  color: var(--accent);\r\n  font-family: var(--font-mono);\r\n  font-weight: 700;\r\n  font-size: 0.86rem;\r\n  opacity: 0.85;\r\n}\r\nbody.category-howto .content pre code { color: inherit; }\r\n\r\n/* ── LANDSCAPE: editorial briefing with H3 player cards ─ */\r\nbody.category-landscape .content h3 {\r\n  /* Each H3 in landscape = a \"player\" in the field — give it a card frame */\r\n  margin-top: 2.5rem;\r\n  padding: 14px 18px 4px;\r\n  border-left: 3px solid var(--accent);\r\n  background: color-mix(in srgb, var(--accent) 4%, transparent);\r\n  border-radius: 0 8px 8px 0;\r\n  font-family: var(--font-display);\r\n  font-size: 1.18rem;\r\n}\r\nbody.category-landscape .content h3 + p {\r\n  margin-top: 0;\r\n  padding: 0 18px 14px;\r\n  background: color-mix(in srgb, var(--accent) 4%, transparent);\r\n  border-left: 3px solid var(--accent);\r\n  margin-left: 0;\r\n  border-radius: 0 0 8px 0;\r\n}\r\n/* Pull-quote treatment for any standalone blockquote */\r\nbody.category-landscape .content blockquote {\r\n  font-size: 1.2rem;\r\n  line-height: 1.5;\r\n  max-width: 90%;\r\n  margin: 2rem auto;\r\n  text-align: center;\r\n  border-left: none;\r\n  border-top: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);\r\n  border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);\r\n  background: transparent;\r\n  border-radius: 0;\r\n  padding: 1.5rem 1rem;\r\n  font-style: italic;\r\n}\r\nbody.category-landscape .content blockquote::before {\r\n  display: none;\r\n}\r\n\r\n/* ── COMPARISON: lab-report tables with winner badges ─ */\r\nbody.category-comparison .content {\r\n  font-feature-settings: 'tnum' on, 'ss01';  /* tabular numerals for tables */\r\n}\r\nbody.category-comparison .content table {\r\n  font-size: 0.92rem;\r\n  box-shadow: 0 6px 20px rgba(0,0,0,0.06);\r\n}\r\nbody.category-comparison .content th {\r\n  background: color-mix(in srgb, var(--accent) 18%, var(--bg-surface));\r\n  color: var(--text);\r\n  text-transform: uppercase;\r\n  letter-spacing: 0.1em;\r\n  font-size: 0.72rem;\r\n  font-weight: 700;\r\n}\r\nbody.category-comparison .content td:first-child {\r\n  font-weight: 600;\r\n  background: color-mix(in srgb, var(--accent) 6%, transparent);\r\n}\r\n/* The first H3 inside a comparison report often names the recommended pick */\r\nbody.category-comparison .content h3:first-of-type::after {\r\n  content: 'Pick';\r\n  display: inline-block;\r\n  margin-left: 10px;\r\n  padding: 2px 10px;\r\n  background: var(--accent);\r\n  color: #fff;\r\n  font-family: var(--font-body);\r\n  font-size: 0.65rem;\r\n  font-weight: 700;\r\n  text-transform: uppercase;\r\n  letter-spacing: 0.1em;\r\n  border-radius: 999px;\r\n  vertical-align: middle;\r\n}\r\n\r\n/* ── PRODUCT: spec-sheet cards for each H3 ─────────── */\r\nbody.category-product .content h3 {\r\n  /* Each product gets a spec-card frame — bordered, slight bg lift */\r\n  margin-top: 2.4rem;\r\n  padding: 16px 18px;\r\n  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));\r\n  background: var(--bg-surface);\r\n  border-radius: 10px;\r\n  display: flex; align-items: baseline; gap: 10px;\r\n  font-family: var(--font-display);\r\n  letter-spacing: -0.01em;\r\n  box-shadow: 0 2px 8px rgba(0,0,0,0.04);\r\n}\r\nbody.category-product .content h3::after {\r\n  /* small \"spec\" tag on each product heading */\r\n  content: 'SPEC';\r\n  margin-left: auto;\r\n  font-family: var(--font-body);\r\n  font-size: 0.6rem;\r\n  font-weight: 700;\r\n  letter-spacing: 0.18em;\r\n  color: var(--accent);\r\n  background: color-mix(in srgb, var(--accent) 10%, transparent);\r\n  padding: 3px 8px;\r\n  border-radius: 4px;\r\n}\r\nbody.category-product .content h3 + p,\r\nbody.category-product .content h3 + ul,\r\nbody.category-product .content h3 + table {\r\n  margin-top: 0.8rem;\r\n  padding-left: 4px;\r\n}\r";

const CATEGORY_STYLES = {"product":"\r\n/* Product category */\r\n.category-product .content h3 {\r\n  display:flex; align-items:baseline; gap:8px;\r\n  border-bottom:1px solid var(--border); padding-bottom:6px;\r\n}\r\n.category-product .content table {\r\n  width:100%; border-collapse:collapse; margin:1.2em 0; font-size:0.92em;\r\n}\r\n.category-product .content table th {\r\n  background:var(--accent); color:#fff; padding:8px 12px; text-align:left;\r\n}\r\n.category-product .content table td { padding:8px 12px; border-bottom:1px solid var(--border); }\r\n.category-product .content table tr:nth-child(even) td { background:var(--bg-surface); }\r\n.category-product .content ul { columns:2; column-gap:2em; }\r\n@media (max-width:600px) { .category-product .content ul { columns:1; } }\r\n.category-product .content a[href*=\"amazon\"],\r\n.category-product .content a[href*=\"ebay\"],\r\n.category-product .content a[href*=\"shop\"],\r\n.category-product .content a[href*=\"buy\"] {\r\n  display:inline-block; padding:3px 10px; border-radius:4px;\r\n  background:var(--accent); color:#fff; text-decoration:none; font-size:0.85em; margin:2px 4px;\r\n}\r\n.quick-links-bar {\r\n  display:flex; flex-wrap:wrap; gap:6px; padding:12px 0; margin-bottom:12px;\r\n  border-bottom:1px solid var(--border);\r\n}\r\n.quick-link {\r\n  padding:5px 12px; border-radius:16px; font-size:0.82em; text-decoration:none;\r\n  border:1px solid var(--border); color:var(--text); transition:all 0.15s;\r\n  white-space:nowrap;\r\n}\r\n.quick-link:hover {\r\n  background:var(--accent); color:#fff; border-color:var(--accent);\r\n}\r\n","comparison":"\r\n/* Comparison category */\r\n.category-comparison .content table {\r\n  width:100%; border-collapse:collapse; margin:1.2em 0;\r\n}\r\n.category-comparison .content table th {\r\n  background:var(--accent); color:#fff; padding:10px 14px;\r\n  text-align:center; font-weight:600; position:sticky; top:0;\r\n}\r\n.category-comparison .content table td {\r\n  padding:10px 14px; border-bottom:1px solid var(--border); text-align:center;\r\n}\r\n.category-comparison .content table tr:nth-child(even) td { background:var(--bg-surface); }\r\n.category-comparison .content table td:first-child {\r\n  text-align:left; font-weight:500; background:color-mix(in srgb, var(--accent) 8%, transparent);\r\n}\r\n.category-comparison .content table td.cmp-pos {\r\n  color:#2e7d32; font-weight:600;\r\n  background:color-mix(in srgb, #4caf50 10%, transparent);\r\n}\r\n.category-comparison .content table td.cmp-neg {\r\n  color:#c62828; font-weight:600;\r\n  background:color-mix(in srgb, #f44336 8%, transparent);\r\n}\r\n.category-comparison .content table td.cmp-mid {\r\n  color:#e68a00;\r\n  background:color-mix(in srgb, #ffa726 8%, transparent);\r\n}\r\n.category-comparison .content h2 ~ p strong:first-child {\r\n  display:inline-block; padding:2px 8px; border-radius:3px;\r\n  background:color-mix(in srgb, var(--accent) 15%, transparent); font-size:0.9em;\r\n}\r\n","howto":"\r\n/* How-to category */\r\n.category-howto .content h2 {\r\n  counter-increment:step-counter;\r\n}\r\n.category-howto .content h2::before {\r\n  content:counter(step-counter);\r\n  display:inline-flex; align-items:center; justify-content:center;\r\n  width:28px; height:28px; border-radius:50%;\r\n  background:var(--accent); color:#fff; font-size:0.8em; font-weight:700;\r\n  margin-right:10px; flex-shrink:0;\r\n}\r\n.category-howto .content { counter-reset:step-counter; }\r\n.category-howto .content blockquote {\r\n  border-left:3px solid var(--accent); background:color-mix(in srgb, var(--accent) 8%, transparent);\r\n  padding:12px 16px; border-radius:0 6px 6px 0; margin:1em 0;\r\n}\r\n.category-howto .content blockquote strong:first-child {\r\n  display:inline-block; margin-bottom:4px; text-transform:uppercase;\r\n  font-size:0.82em; letter-spacing:0.5px;\r\n}\r\n.category-howto .content h2#quick-guide + ol,\r\n.category-howto .content h2#quick-guide ~ ol:first-of-type {\r\n  background:color-mix(in srgb, var(--accent) 8%, transparent);\r\n  border:1px solid color-mix(in srgb, var(--accent) 20%, transparent);\r\n  border-radius:8px; padding:14px 14px 14px 32px; font-size:0.95em; line-height:1.8;\r\n}\r\n.category-howto .content h2#quick-guide {\r\n  counter-increment:none;\r\n}\r\n.category-howto .content h2#quick-guide::before {\r\n  content:'\\\\26A1'; background:none; width:auto; height:auto; margin-right:6px;\r\n}\r\n","landscape":"\r\n/* Landscape category */\r\n.category-landscape .content h3 {\r\n  display:flex; align-items:center; gap:8px;\r\n  padding:8px 0; border-bottom:1px solid var(--border);\r\n}\r\n.category-landscape .content table {\r\n  width:100%; border-collapse:collapse; margin:1em 0; font-size:0.92em;\r\n}\r\n.category-landscape .content table th {\r\n  background:var(--accent); color:#fff; padding:8px 12px; text-align:left;\r\n}\r\n.category-landscape .content table td { padding:8px 12px; border-bottom:1px solid var(--border); }\r\n.category-landscape .content table tr:nth-child(even) td { background:var(--bg-surface); }\r\n.category-landscape .content blockquote {\r\n  border-left:3px solid var(--gold, #d4a73a);\r\n  background:color-mix(in srgb, var(--gold, #d4a73a) 8%, transparent);\r\n  padding:10px 14px; border-radius:0 6px 6px 0;\r\n}\r\n","factcheck":"\r\n/* Fact-check category */\r\n.category-factcheck .hero {\r\n  background:linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);\r\n}\r\n.category-factcheck .content h2:first-of-type {\r\n  font-size:1.4em; text-align:center; padding:16px 0; border:none;\r\n  background:color-mix(in srgb, var(--accent) 8%, transparent);\r\n  border-radius:8px; margin:1em 0;\r\n}\r\n.category-factcheck .content blockquote {\r\n  position:relative; padding-left:20px;\r\n}\r\n.category-factcheck .content h2 ~ h3 {\r\n  padding:6px 10px; border-radius:4px;\r\n  border-left:3px solid var(--accent);\r\n}\r\n.category-factcheck .content strong:only-child {\r\n  display:inline-block; padding:4px 12px; border-radius:4px;\r\n  font-size:1.1em;\r\n}\r\n"};

const REPORT_SCRIPT = "(function() {\n  document.addEventListener('keydown', function(e) {\n    if (e.key !== 'Escape' || e.defaultPrevented) return;\n    var t = e.target;\n    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;\n    var menu = document.getElementById('export-menu');\n    if (menu && menu.classList.contains('open')) { menu.classList.remove('open'); return; }\n    try { window.close(); } catch (err) {}\n    setTimeout(function() { if (!window.closed) history.back(); }, 50);\n  });\n\n  var exportBtn = document.getElementById('btn-export');\n  var exportMenu = document.getElementById('export-menu');\n  if (!exportBtn || !exportMenu) return;\n  exportBtn.addEventListener('click', function(e) {\n    e.stopPropagation();\n    exportMenu.classList.toggle('open');\n  });\n  exportMenu.addEventListener('click', function(e) { e.stopPropagation(); });\n  document.addEventListener('click', function() { exportMenu.classList.remove('open'); });\n\n  document.getElementById('btn-pdf').addEventListener('click', function() {\n    exportMenu.classList.remove('open');\n    window.print();\n  });\n\n  document.getElementById('btn-html').addEventListener('click', function() {\n    exportMenu.classList.remove('open');\n    var blob = new Blob([document.documentElement.outerHTML], { type: 'text/html' });\n    var a = document.createElement('a');\n    a.href = URL.createObjectURL(blob);\n    a.download = document.title.replace(/[^a-z0-9]+/gi, '-').substring(0, 60) + '.html';\n    a.click();\n  });\n\n  var tocLinks = document.querySelectorAll('.toc-sidebar nav a[href^=\"#\"]');\n  tocLinks.forEach(function(link) {\n    link.addEventListener('click', function(e) {\n      var id = link.getAttribute('href').slice(1);\n      var target = document.getElementById(id);\n      if (!target) return;\n      e.preventDefault();\n      target.scrollIntoView({ behavior: 'smooth', block: 'start' });\n      history.replaceState(null, '', '#' + id);\n    });\n  });\n\n  var tocMap = {};\n  tocLinks.forEach(function(link) {\n    tocMap[link.getAttribute('href').slice(1)] = link;\n  });\n  var activeId = null;\n  function setActive(id) {\n    if (id === activeId) return;\n    if (activeId && tocMap[activeId]) tocMap[activeId].classList.remove('active');\n    if (id && tocMap[id]) tocMap[id].classList.add('active');\n    activeId = id;\n  }\n  var headings = document.querySelectorAll('.content h2[id], .content h3[id]');\n  if (headings.length && 'IntersectionObserver' in window) {\n    var visible = new Set();\n    var io = new IntersectionObserver(function(entries) {\n      entries.forEach(function(en) {\n        if (en.isIntersecting) visible.add(en.target.id);\n        else visible.delete(en.target.id);\n      });\n      var current = null;\n      for (var i = 0; i < headings.length; i++) {\n        if (visible.has(headings[i].id)) { current = headings[i].id; break; }\n      }\n      if (current) setActive(current);\n    }, { rootMargin: '-10% 0px -75% 0px', threshold: 0 });\n    headings.forEach(function(h) { io.observe(h); });\n  }\n})();\n\nif (document.body.classList.contains('category-comparison')) {\n  const pos = /^(yes|excellent|best|great|strong|fast|high|superior|winner|free|unlimited|native|full|advanced|built[- ]in|✓|✅|⭐)/i;\n  const neg = /^(no|none|poor|weak|slow|low|limited|lacking|missing|basic|minimal|✗|❌|N\\/A$)/i;\n  const mid = /^(moderate|average|fair|partial|some|decent|okay|mixed|varies|depends)/i;\n  document.querySelectorAll('.content table td').forEach(td => {\n    if (td.cellIndex === 0) return;\n    const t = td.textContent.trim();\n    if (pos.test(t)) td.classList.add('cmp-pos');\n    else if (neg.test(t)) td.classList.add('cmp-neg');\n    else if (mid.test(t)) td.classList.add('cmp-mid');\n  });\n}";

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
 * @param {string} markdownText
 * @param {string} fallback
 * @returns {{ title: string, markdown: string }}
 */
export function extractReportTitle(markdownText, fallback) {
  if (!markdownText) {
    return { title: fallback, markdown: markdownText };
  }

  /** @type {Array<{ level: number, start: number, end: number, text: string }>} */
  const candidates = [];
  for (const level of [1, 2]) {
    const hashes = '#'.repeat(level);
    const re = new RegExp(`^${hashes} +(.+?)\\s*$`, 'gm');
    for (const m of markdownText.matchAll(re)) {
      const cand = m[1].trim().replace(/#+$/, '').trim();
      if (cand && !GENERIC_HEADINGS.has(cand.toLowerCase())) {
        candidates.push({
          level,
          start: m.index ?? 0,
          end: (m.index ?? 0) + m[0].length,
          text: cand,
        });
      }
    }
  }

  candidates.sort((a, b) => a.level - b.level || a.start - b.start);
  if (candidates.length) {
    const chosen = candidates[0];
    const stripped = (markdownText.slice(0, chosen.start) + markdownText.slice(chosen.end)).trimStart();
    return { title: chosen.text, markdown: stripped };
  }
  return { title: fallback, markdown: markdownText };
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
 * Category-specific CSS (palette block + structural rules).
 * @param {string | null | undefined} category
 * @returns {string}
 */
/** Visual-report style key (legacy CSS blocks) for normalized categories. */
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

export function categoryCss(category) {
  const normalized = normalizeResearchCategory(category);
  if (!normalized) {
    return '';
  }
  const visualKey = CATEGORY_VISUAL_KEYS[normalized] ?? normalized;
  return CATEGORY_PALETTES + (CATEGORY_STYLES[visualKey] ?? '');
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
 * Generate a self-contained editorial HTML report page.
 * @param {string} question
 * @param {string} reportMarkdown
 * @param {ResearchSource[]} [sources]
 * @param {ResearchStats} [stats]
 * @param {string | null | undefined} [category]
 * @param {string | null | undefined} [researchId]
 * @returns {string}
 */
export function generateVisualReport(
  question,
  reportMarkdown,
  sources = [],
  stats = {},
  category = null,
  researchId = null,
) {
  void researchId; // Phase 5b: hero/section images, hide/reroll endpoints

  let markdown = stripThinking(reportMarkdown) ?? '';
  const { title: synthesized, markdown: bodyMarkdown } = extractReportTitle(markdown, question);
  markdown = promoteBoldHeadings(bodyMarkdown);

  let reportHtml = mdToHtml(markdown);
  const headings = extractHeadings(markdown);
  reportHtml = applyHeadingIds(reportHtml, headings);

  // Product quick-links bar (no OG images in v1)
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
    category_css: categoryCss(category),
    body_class: bodyClass,
    session_id_js: 'null',
    spare_images_js: '[]',
  });

  // First-party export/print script is injected AFTER sanitization (not from model output).
  return html.replace(
    '</body>',
    `<script>\n${REPORT_SCRIPT}\n</script>\n</body>`,
  );
}
