/**
 * The thing you captured, before it is an issue.
 *
 * Every capture entry point — right-click "Create issue", the menubar button,
 * a drop on the Issues rail tile — produces one of these and hands it to the
 * same popover. Surfaces describe *what they have*; nothing here knows how an
 * issue is stored, so this module stays pure and testable.
 *
 * Phase 2 of `documentation/plans/issues-app-v2.md`.
 */

import type { IssueCodeRef, IssueGitLink, IssueRelationKind } from '../types';

/** Drag MIME for a capture payload moving through the shell. */
export const ISSUE_CAPTURE_MIME = 'application/x-minnow-issue-capture';

/** What one attached piece of context is. Drives the chip icon and the link write. */
export type CaptureItemKind = 'code' | 'git' | 'chat' | 'issue' | 'file' | 'text';

/**
 * One attached piece of context.
 *
 * `label` is what the chip reads; the typed field carries the data that becomes
 * a real link. An item with only `text` seeds the description instead.
 */
export interface CaptureItem {
  kind: CaptureItemKind;
  label: string;
  /** Secondary line on the chip (a commit subject, a line range). */
  detail?: string;
  codeRef?: IssueCodeRef;
  gitLink?: Omit<IssueGitLink, 'addedAt'>;
  chatId?: string;
  issueRef?: { issueId: string; kind: IssueRelationKind };
  /** Verbatim text folded into the description (selection, terminal output). */
  text?: string;
}

/** A capture in flight: a title seed plus the context that came with it. */
export interface CapturePayload {
  /** Seed for the title field. The user always sees and can edit it. */
  title?: string;
  /** Seed for the description body. */
  description?: string;
  workspacePath?: string;
  items: CaptureItem[];
  /** Where this came from, shown above the chips ("Editor selection"). */
  sourceLabel?: string;
}

/** An empty payload. Every builder starts here so `items` is never undefined. */
export function emptyCapturePayload(): CapturePayload {
  return { items: [] };
}

function trimTo(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The title the popover opens with.
 *
 * Prefers the explicit seed, then the first line of any captured text, then the
 * first item's label. Never empty-string: an untitled capture still gets a
 * placeholder the user can accept, which is the whole point of quick capture.
 */
export function captureTitleSeed(payload: CapturePayload): string {
  const explicit = payload.title?.trim();
  if (explicit) return trimTo(explicit, 120);

  const text = payload.items.find((item) => item.text?.trim())?.text ?? payload.description ?? '';
  const firstLine = text.split('\n').find((line) => line.trim().length > 0);
  if (firstLine) return trimTo(firstLine, 120);

  // A label only makes a title when the item is what the issue is *about*.
  // Ambient context — the chat you happened to be in — is not, and seeding
  // "Current chat" as a title is worse than an empty field with a placeholder.
  const subject = payload.items.find((item) => TITLE_BEARING_KINDS.has(item.kind));
  if (subject) return trimTo(subject.label, 120);
  return '';
}

/** Item kinds specific enough that their label can stand in as a title. */
const TITLE_BEARING_KINDS: ReadonlySet<CaptureItemKind> = new Set([
  'code',
  'file',
  'git',
  'issue',
]);

/** Fence captured text so a pasted stack trace does not become markdown soup. */
function fenceText(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed) return '';
  const fence = trimmed.includes('```') ? '````' : '```';
  return `${fence}\n${trimmed}\n${fence}`;
}

/**
 * The description the popover opens with: the seed, then every captured text
 * block fenced beneath it. Code items keep their path as the fence caption so
 * the block is still identifiable after the chip is edited away.
 */
export function captureDescriptionSeed(payload: CapturePayload): string {
  const blocks: string[] = [];
  const seed = payload.description?.trim();
  if (seed) blocks.push(seed);

  for (const item of payload.items) {
    const text = item.text?.trim();
    if (!text) continue;
    const caption = item.kind === 'code' && item.label ? `${item.label}\n` : '';
    const fenced = fenceText(text);
    if (fenced) blocks.push(`${caption}${fenced}`);
  }
  return blocks.join('\n\n');
}

/** Links to append once the issue exists. Text-only items contribute nothing. */
export function capturePayloadToLinks(payload: CapturePayload): {
  codeRefs: IssueCodeRef[];
  gitLinks: Array<Omit<IssueGitLink, 'addedAt'>>;
  chatIds: string[];
  issueRefs: Array<{ issueId: string; kind: IssueRelationKind }>;
} {
  const codeRefs: IssueCodeRef[] = [];
  const gitLinks: Array<Omit<IssueGitLink, 'addedAt'>> = [];
  const chatIds: string[] = [];
  const issueRefs: Array<{ issueId: string; kind: IssueRelationKind }> = [];

  for (const item of payload.items) {
    if (item.codeRef?.path) codeRefs.push(item.codeRef);
    if (item.gitLink?.ref) gitLinks.push(item.gitLink);
    if (item.chatId && !chatIds.includes(item.chatId)) chatIds.push(item.chatId);
    if (item.issueRef?.issueId) issueRefs.push(item.issueRef);
  }
  return { codeRefs, gitLinks, chatIds, issueRefs };
}

/** True when the payload carries nothing worth filing. */
export function isCapturePayloadEmpty(payload: CapturePayload): boolean {
  return (
    payload.items.length === 0 &&
    !payload.title?.trim() &&
    !payload.description?.trim()
  );
}

/** Merge payloads (menubar ambient context + a dropped item), deduping items. */
export function mergeCapturePayloads(
  base: CapturePayload,
  extra: CapturePayload,
): CapturePayload {
  const items = [...base.items];
  for (const item of extra.items) {
    if (items.some((existing) => captureItemsEqual(existing, item))) continue;
    items.push(item);
  }
  return {
    title: extra.title?.trim() || base.title,
    description: [base.description, extra.description].filter(Boolean).join('\n\n') || undefined,
    workspacePath: extra.workspacePath || base.workspacePath,
    sourceLabel: extra.sourceLabel || base.sourceLabel,
    items,
  };
}

/** Identity for dedupe: same kind and same underlying target. */
export function captureItemsEqual(a: CaptureItem, b: CaptureItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.codeRef || b.codeRef) {
    return (
      a.codeRef?.path === b.codeRef?.path &&
      (a.codeRef?.startLine ?? 0) === (b.codeRef?.startLine ?? 0) &&
      (a.codeRef?.endLine ?? 0) === (b.codeRef?.endLine ?? 0)
    );
  }
  if (a.gitLink || b.gitLink) {
    return a.gitLink?.kind === b.gitLink?.kind && a.gitLink?.ref === b.gitLink?.ref;
  }
  if (a.chatId || b.chatId) return a.chatId === b.chatId;
  if (a.issueRef || b.issueRef) return a.issueRef?.issueId === b.issueRef?.issueId;
  return a.label === b.label && a.text === b.text;
}

/**
 * Serialize onto a DataTransfer.
 *
 * `text/plain` is set too so a capture dragged into a text field still produces
 * something readable rather than JSON.
 */
export function setCaptureDragData(
  dataTransfer: DataTransfer,
  payload: CapturePayload,
): void {
  dataTransfer.setData(ISSUE_CAPTURE_MIME, JSON.stringify(payload));
  const plain = captureTitleSeed(payload);
  if (plain) dataTransfer.setData('text/plain', plain);
  dataTransfer.effectAllowed = 'copyLink';
}

/** True when the transfer carries a capture payload. */
export function hasCaptureDragData(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(ISSUE_CAPTURE_MIME);
}

/** Read a capture payload off a completed drop. Returns null on anything odd. */
export function parseCaptureDragData(
  dataTransfer: DataTransfer | null,
): CapturePayload | null {
  if (!dataTransfer) return null;
  const raw = dataTransfer.getData(ISSUE_CAPTURE_MIME).trim();
  if (!raw) return null;
  return parseCapturePayloadJson(raw);
}

/** Parse and sanitize a serialized payload (shared by drag and any future IPC). */
export function parseCapturePayloadJson(raw: string): CapturePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items: CaptureItem[] = [];
  for (const entry of rawItems) {
    const item = sanitizeCaptureItem(entry);
    if (item) items.push(item);
  }
  const payload: CapturePayload = { items };
  if (typeof record.title === 'string' && record.title.trim()) payload.title = record.title;
  if (typeof record.description === 'string' && record.description.trim()) {
    payload.description = record.description;
  }
  if (typeof record.workspacePath === 'string' && record.workspacePath.trim()) {
    payload.workspacePath = record.workspacePath;
  }
  if (typeof record.sourceLabel === 'string' && record.sourceLabel.trim()) {
    payload.sourceLabel = record.sourceLabel;
  }
  if (items.length === 0 && !payload.title && !payload.description) return null;
  return payload;
}

const CAPTURE_ITEM_KINDS: readonly CaptureItemKind[] = [
  'code',
  'git',
  'chat',
  'issue',
  'file',
  'text',
];

const GIT_LINK_KINDS: ReadonlyArray<IssueGitLink['kind']> = [
  'commit',
  'branch',
  'pr',
  'github-issue',
];

function sanitizeCaptureItem(raw: unknown): CaptureItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string' || !CAPTURE_ITEM_KINDS.includes(kind as CaptureItemKind)) {
    return null;
  }
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  if (!label) return null;

  const item: CaptureItem = { kind: kind as CaptureItemKind, label };
  if (typeof record.detail === 'string' && record.detail.trim()) item.detail = record.detail.trim();
  if (typeof record.text === 'string' && record.text.trim()) item.text = record.text;
  if (typeof record.chatId === 'string' && record.chatId.trim()) item.chatId = record.chatId.trim();

  const codeRef = record.codeRef;
  if (codeRef && typeof codeRef === 'object') {
    const ref = codeRef as Record<string, unknown>;
    const path = typeof ref.path === 'string' ? ref.path.trim() : '';
    if (path) {
      item.codeRef = { path };
      const start = Number(ref.startLine);
      const end = Number(ref.endLine);
      if (Number.isFinite(start) && start >= 1) item.codeRef.startLine = Math.floor(start);
      if (Number.isFinite(end) && end >= 1) item.codeRef.endLine = Math.floor(end);
      if (typeof ref.snippet === 'string' && ref.snippet.trim()) item.codeRef.snippet = ref.snippet;
    }
  }

  const gitLink = record.gitLink;
  if (gitLink && typeof gitLink === 'object') {
    const link = gitLink as Record<string, unknown>;
    const linkKind = link.kind;
    const ref = typeof link.ref === 'string' ? link.ref.trim() : '';
    if (
      ref &&
      typeof linkKind === 'string' &&
      GIT_LINK_KINDS.includes(linkKind as IssueGitLink['kind'])
    ) {
      item.gitLink = { kind: linkKind as IssueGitLink['kind'], ref };
      if (typeof link.url === 'string' && link.url.trim()) item.gitLink.url = link.url.trim();
      if (typeof link.title === 'string' && link.title.trim()) item.gitLink.title = link.title.trim();
    }
  }

  const issueRef = record.issueRef;
  if (issueRef && typeof issueRef === 'object') {
    const ref = issueRef as Record<string, unknown>;
    const issueId = typeof ref.issueId === 'string' ? ref.issueId.trim() : '';
    if (issueId) {
      const relKind = typeof ref.kind === 'string' ? ref.kind : 'related';
      item.issueRef = { issueId, kind: relKind as IssueRelationKind };
    }
  }

  return item;
}
