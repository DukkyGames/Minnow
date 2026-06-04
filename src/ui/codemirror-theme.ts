/**
 * CodeMirror syntax highlighting aligned with highlight.js GitHub (see main.ts).
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { getMode, getStoredTheme } from '../theme';

/** GitHub light palette — mirrors highlight.js/styles/github.min.css */
const gh = {
  text: 'var(--mn-fg)',
  comment: 'var(--mn-fg-muted)',
  keyword: 'var(--cm-keyword)',
  title: 'var(--cm-title)',
  attr: 'var(--cm-attr)',
  string: 'var(--cm-string)',
  builtin: 'var(--mn-warning)',
  tag: 'var(--mn-success)',
  invalid: 'var(--mn-danger)',
} as const;

const minnowHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: gh.comment },
  { tag: tags.lineComment, color: gh.comment },
  { tag: tags.blockComment, color: gh.comment },
  { tag: tags.docComment, color: gh.comment, fontStyle: 'italic' },
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.operatorKeyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
    ],
    color: gh.keyword,
  },
  { tag: tags.self, color: gh.keyword },
  { tag: [tags.null, tags.atom, tags.bool], color: gh.attr },
  {
    tag: [
      tags.number,
      tags.integer,
      tags.float,
      tags.literal,
      tags.operator,
      tags.derefOperator,
      tags.arithmeticOperator,
      tags.logicOperator,
      tags.bitwiseOperator,
      tags.compareOperator,
      tags.updateOperator,
      tags.definitionOperator,
      tags.typeOperator,
      tags.controlOperator,
    ],
    color: gh.attr,
  },
  {
    tag: [
      tags.propertyName,
      tags.attributeName,
      tags.variableName,
      tags.local(tags.variableName),
    ],
    color: gh.attr,
  },
  {
    tag: [
      tags.string,
      tags.docString,
      tags.character,
      tags.attributeValue,
      tags.special(tags.string),
    ],
    color: gh.string,
  },
  { tag: [tags.regexp, tags.escape], color: gh.builtin },
  {
    tag: [
      tags.definition(tags.variableName),
      tags.definition(tags.propertyName),
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
    ],
    color: gh.title,
  },
  {
    tag: [
      tags.className,
      tags.typeName,
      tags.namespace,
      tags.macroName,
      tags.standard(tags.name),
    ],
    color: gh.title,
  },
  {
    tag: [tags.tagName, tags.labelName, tags.name],
    color: gh.tag,
  },
  { tag: tags.meta, color: gh.comment },
  { tag: tags.processingInstruction, color: gh.comment },
  {
    tag: [
      tags.heading,
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ],
    color: gh.attr,
    fontWeight: 'bold',
    textDecoration: 'underline',
  },
  { tag: tags.link, color: gh.attr, textDecoration: 'underline' },
  { tag: tags.url, color: gh.attr },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  {
    tag: [
      tags.punctuation,
      tags.separator,
      tags.bracket,
      tags.squareBracket,
      tags.paren,
      tags.brace,
      tags.angleBracket,
      tags.contentSeparator,
    ],
    color: gh.text,
  },
  { tag: tags.invalid, color: gh.invalid },
]);

/** Selection + chrome: sync CM6 dark/light facet with Minnow palette (avoids default light gray on dark UI). */
const minnowEditorColorSchemeTheme = EditorView.theme(
  {
    '.cm-selectionBackground': { backgroundColor: 'var(--mn-selection-bg)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'var(--mn-selection-bg)',
    },
  },
  { dark: getMode(getStoredTheme()) === 'dark' },
);

/**
 * LSP autocomplete + tooltips — match Minnow surfaces (overrides CodeMirror light defaults).
 */
const minnowEditorTooltipTheme = EditorView.theme({
  '.cm-tooltip': {
    backgroundColor: 'var(--mn-surface-2)',
    color: 'var(--mn-fg)',
    border: '1px solid var(--mn-border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-popover-soft)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
  '.cm-tooltip .cm-tooltip-arrow:before': {
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  '.cm-tooltip .cm-tooltip-arrow:after': {
    borderTopColor: 'var(--mn-surface-2)',
    borderBottomColor: 'var(--mn-surface-2)',
  },
  '.cm-lintRange-error': {
    backgroundImage:
      'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><path d="m0 3 l2 -2 l1 0 l2 2 l1 0" stroke="%23ef4444" fill="none" stroke-width=".7"/></svg>\')',
  },
  '.cm-lintRange-warning': {
    backgroundImage:
      'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><path d="m0 3 l2 -2 l1 0 l2 2 l1 0" stroke="%23f59e0b" fill="none" stroke-width=".7"/></svg>\')',
  },
  '.cm-gutter-lint': {
    width: '1.1em',
  },
  '.cm-gutter-lint .cm-lintMarker-error': {
    color: 'var(--mn-danger)',
  },
  '.cm-gutter-lint .cm-lintMarker-warning': {
    color: 'var(--mn-warning)',
  },
  '.cm-lsp-hover, .cm-lsp-signature': {
    maxWidth: 'min(480px, 90vw)',
    padding: '6px 10px',
    lineHeight: '1.45',
  },
  '.cm-lsp-signature-param--active': {
    fontWeight: 'bold',
    textDecoration: 'underline',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul': {
      backgroundColor: 'var(--mn-surface-2)',
      border: 'none',
    },
    '& > ul > li': {
      color: 'var(--mn-fg)',
    },
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--mn-surface-elevated)',
      color: 'var(--mn-fg)',
    },
    '& > ul > completion-section': {
      color: 'var(--mn-fg-muted)',
      borderBottomColor: 'var(--mn-border)',
    },
    '& .cm-completionIcon': {
      opacity: 0.9,
    },
    '& .cm-completionLabel': {
      color: 'inherit',
    },
    '& .cm-completionDetail': {
      color: 'var(--mn-fg-muted)',
      fontStyle: 'normal',
    },
    '& > ul > li[aria-selected] .cm-completionDetail': {
      color: 'var(--mn-fg-muted)',
      opacity: 0.9,
    },
  },
});

/** Shared editor extensions: GitHub-style token colors for the file viewer. */
export function minnowEditorExtensions(): Extension[] {
  return [
    syntaxHighlighting(minnowHighlightStyle),
    minnowEditorColorSchemeTheme,
    minnowEditorTooltipTheme,
  ];
}
