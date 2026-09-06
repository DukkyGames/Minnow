/**
 * Comment + activity timeline for the issue detail panel.
 *
 * `IssueCard.comments` and `IssueCard.activity` have been written since Phase 4
 * — `issue_comment` is one of the agent tools — but nothing rendered them, so an
 * agent reporting back on an issue was writing into a void. This is the reader.
 */

import { addIssueComment, deleteIssueComment, scheduleSaveIssues } from '../state/issues-store';
import { parseMarkdownBlocks } from '../issues/markdown-blocks';
import { inlineToHtml } from '../issues/markdown-inline';
import type { IssueActivityEntry, IssueCard, IssueComment } from '../types';
import { appConfirm } from './app-dialog';

/** Called after a write so the panel repaints from store state. */
export type CommentsChanged = () => void;

/**
 * Drafts survive the repaint. The detail panel rebuilds on every store change
 * (including the agent's own comment landing), so a half-typed reply that lived
 * only in the textarea would vanish under the author.
 */
const draftByIssueId = new Map<string, string>();

/** Posting repaints the panel; put the caret back so replies can be consecutive. */
let refocusComposerFor: string | null = null;

/** True when focus sits in the comment composer, which a remount would wipe. */
export function isIssueCommentComposerFocused(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return Boolean(active.closest('.issues-comments__composer'));
}

// ── Formatting ───────────────────────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now" / "4m" / "3h" / "6d", falling back to a date past a week. */
function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (!Number.isFinite(delta)) return '';
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function absoluteTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

function authorLabel(comment: IssueComment): string {
  if (comment.author?.trim()) return comment.author.trim();
  if (comment.authorKind === 'agent') return 'Agent';
  if (comment.authorKind === 'system') return 'Minnow';
  return 'You';
}

/** `agent_running` → "Agent running"; `moved` → "Moved". */
function activityLabel(entry: IssueActivityEntry): string {
  const words = entry.kind.replace(/[_-]+/g, ' ').trim();
  const phrase = words ? `${words[0].toUpperCase()}${words.slice(1)}` : 'Updated';
  const details = Object.entries(entry.data ?? {})
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => `${key} ${String(value)}`);
  const actor = entry.actor?.trim();
  const bits = [phrase];
  if (details.length) bits.push(details.join(', '));
  if (actor) bits.push(`by ${actor}`);
  return bits.join(' · ');
}

// ── Comment bodies ───────────────────────────────────────────────────────────

/**
 * Read-only render of the same constrained markdown the description editor
 * writes. Deliberately a separate, non-editable pass: comments are a log, and
 * mounting an editor per comment would be both heavy and wrong.
 */
function renderCommentBody(markdown: string): HTMLElement {
  const body = document.createElement('div');
  body.className = 'issues-comment__body';

  for (const block of parseMarkdownBlocks(markdown)) {
    switch (block.kind) {
      case 'blank':
        break;
      case 'heading': {
        const level = Math.min(6, Math.max(1, block.level ?? 1));
        const el = document.createElement(`h${level}`);
        el.innerHTML = inlineToHtml(block.source.replace(/^ {0,3}#{1,6}\s+/, ''));
        body.appendChild(el);
        break;
      }
      case 'code': {
        const pre = document.createElement('pre');
        pre.className = 'issues-comment__code';
        pre.textContent = block.source.replace(/^ {0,3}```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
        body.appendChild(pre);
        break;
      }
      case 'quote': {
        const quote = document.createElement('blockquote');
        quote.innerHTML = inlineToHtml(
          block.source
            .split('\n')
            .map((line) => line.replace(/^ {0,3}>\s?/, ''))
            .join('\n'),
        ).replace(/\n/g, '<br>');
        body.appendChild(quote);
        break;
      }
      case 'divider':
        body.appendChild(document.createElement('hr'));
        break;
      case 'bullet-list':
      case 'ordered-list':
      case 'task-list': {
        const list = document.createElement(block.kind === 'ordered-list' ? 'ol' : 'ul');
        if (block.kind === 'task-list') list.className = 'issues-comment__tasks';
        for (const line of block.source.split('\n')) {
          const text = line.replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/, '');
          if (!text.trim()) continue;
          const li = document.createElement('li');
          const task = /^\[([ xX])\]\s?(.*)$/.exec(text);
          if (task) {
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = task[1].toLowerCase() === 'x';
            box.disabled = true;
            li.append(box, document.createTextNode(' '));
            const span = document.createElement('span');
            span.innerHTML = inlineToHtml(task[2]);
            li.appendChild(span);
          } else {
            li.innerHTML = inlineToHtml(text);
          }
          list.appendChild(li);
        }
        body.appendChild(list);
        break;
      }
      default: {
        const p = document.createElement('p');
        p.innerHTML = inlineToHtml(block.source).replace(/\n/g, '<br>');
        body.appendChild(p);
      }
    }
  }

  if (!body.childElementCount) {
    const p = document.createElement('p');
    p.textContent = markdown;
    body.appendChild(p);
  }
  return body;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function commentRow(
  issueId: string,
  comment: IssueComment,
  onChanged: CommentsChanged,
): HTMLElement {
  const row = document.createElement('article');
  row.className = `issues-comment issues-comment--${comment.authorKind}`;
  row.dataset.commentId = comment.id;

  const avatar = document.createElement('span');
  avatar.className = 'issues-comment__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = authorLabel(comment).slice(0, 1).toUpperCase();
  row.appendChild(avatar);

  const main = document.createElement('div');
  main.className = 'issues-comment__main';

  const head = document.createElement('div');
  head.className = 'issues-comment__head';

  const author = document.createElement('span');
  author.className = 'issues-comment__author';
  author.textContent = authorLabel(comment);
  head.appendChild(author);

  if (comment.authorKind !== 'user') {
    const badge = document.createElement('span');
    badge.className = 'issues-comment__badge';
    badge.textContent = comment.authorKind === 'agent' ? 'agent' : 'system';
    head.appendChild(badge);
  }

  const when = document.createElement('time');
  when.className = 'issues-comment__time';
  when.dateTime = new Date(comment.createdAt).toISOString();
  when.textContent = relativeTime(comment.createdAt);
  when.title = absoluteTime(comment.createdAt);
  head.appendChild(when);

  if (comment.editedAt) {
    const edited = document.createElement('span');
    edited.className = 'issues-comment__time';
    edited.textContent = '(edited)';
    edited.title = absoluteTime(comment.editedAt);
    head.appendChild(edited);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'issues-comment__delete';
  remove.setAttribute('aria-label', `Delete comment by ${authorLabel(comment)}`);
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    void (async () => {
      const ok = await appConfirm('Delete this comment?', {
        confirmLabel: 'Delete',
        title: 'Delete comment',
      });
      if (!ok) return;
      if (!deleteIssueComment(issueId, comment.id)) return;
      scheduleSaveIssues();
      onChanged();
    })();
  });
  head.appendChild(remove);

  main.appendChild(head);
  main.appendChild(renderCommentBody(comment.body));
  row.appendChild(main);
  return row;
}

function activityRow(entry: IssueActivityEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'issues-activity-row';

  const dot = document.createElement('span');
  dot.className = 'issues-activity-row__dot';
  dot.setAttribute('aria-hidden', 'true');
  row.appendChild(dot);

  const text = document.createElement('span');
  text.className = 'issues-activity-row__text';
  text.textContent = activityLabel(entry);
  row.appendChild(text);

  const when = document.createElement('time');
  when.className = 'issues-activity-row__time';
  when.dateTime = new Date(entry.at).toISOString();
  when.textContent = relativeTime(entry.at);
  when.title = absoluteTime(entry.at);
  row.appendChild(when);
  return row;
}

// ── Composer ─────────────────────────────────────────────────────────────────

function composer(issueId: string, onChanged: CommentsChanged): HTMLElement {
  const wrap = document.createElement('form');
  wrap.className = 'issues-comments__composer';

  const input = document.createElement('textarea');
  input.className = 'issues-comments__input';
  input.rows = 2;
  input.placeholder = 'Leave a comment…';
  input.setAttribute('aria-label', 'New comment');
  input.value = draftByIssueId.get(issueId) ?? '';

  const actions = document.createElement('div');
  actions.className = 'issues-comments__composer-actions';

  const hint = document.createElement('span');
  hint.className = 'issues-comments__hint';
  hint.textContent = '⌘/Ctrl + Enter to post';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'issues-btn issues-btn--primary';
  submit.textContent = 'Comment';
  submit.disabled = input.value.trim().length === 0;

  actions.append(hint, submit);
  wrap.append(input, actions);

  const post = (): void => {
    const body = input.value.trim();
    if (!body) return;
    if (!addIssueComment(issueId, { body, authorKind: 'user' })) return;
    draftByIssueId.delete(issueId);
    input.value = '';
    refocusComposerFor = issueId;
    scheduleSaveIssues();
    onChanged();
  };

  input.addEventListener('input', () => {
    draftByIssueId.set(issueId, input.value);
    submit.disabled = input.value.trim().length === 0;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    post();
  });
  wrap.addEventListener('submit', (event) => {
    event.preventDefault();
    post();
  });

  return wrap;
}

// ── Section ──────────────────────────────────────────────────────────────────

/**
 * Render the timeline into `host`.
 *
 * Comments and activity share one chronological list: an agent's status move
 * only makes sense next to the comment that explains it.
 */
export function renderIssueComments(
  host: HTMLElement,
  issue: IssueCard,
  onChanged: CommentsChanged,
): void {
  const comments = issue.comments ?? [];
  const activity = issue.activity ?? [];

  const timeline = document.createElement('div');
  timeline.className = 'issues-comments__timeline';

  const entries: Array<{ at: number; node: HTMLElement }> = [
    ...comments.map((comment) => ({
      at: comment.createdAt,
      node: commentRow(issue.id, comment, onChanged),
    })),
    ...activity.map((entry) => ({ at: entry.at, node: activityRow(entry) })),
  ].sort((a, b) => a.at - b.at);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'issues-comments__empty';
    empty.textContent = 'No comments yet. Agents post here too.';
    timeline.appendChild(empty);
  } else {
    for (const entry of entries) timeline.appendChild(entry.node);
  }

  host.appendChild(timeline);
  const box = composer(issue.id, onChanged);
  host.appendChild(box);

  if (refocusComposerFor === issue.id) {
    refocusComposerFor = null;
    // The section is still detached here — the panel appends it once every
    // section is built — and focus() on a detached node is a no-op.
    queueMicrotask(() => {
      box.querySelector<HTMLTextAreaElement>('.issues-comments__input')?.focus();
    });
  }
}

/** Heading count for the section title, e.g. "Activity · 3". */
export function issueCommentCount(issue: IssueCard): number {
  return issue.comments?.length ?? 0;
}
