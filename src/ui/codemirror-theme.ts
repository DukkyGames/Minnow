/**
 * CodeMirror syntax highlighting aligned with highlight.js GitHub (see main.ts).
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';

/** GitHub light palette — mirrors highlight.js/styles/github.min.css */
const gh = {
  text: 'var(--text)',
  comment: 'var(--text-muted)',
  keyword: 'var(--cm-keyword)',
  title: 'var(--cm-title)',
  attr: 'var(--cm-attr)',
  string: 'var(--cm-string)',
  builtin: 'var(--warning)',
  tag: 'var(--success)',
  invalid: 'var(--danger)',
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

/** Shared editor extensions: GitHub-style token colors for the file viewer. */
export function minnowEditorExtensions(): Extension[] {
  return [syntaxHighlighting(minnowHighlightStyle)];
}
