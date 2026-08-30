/**
 * Issues detail slide-over / deep-link panel (MIN-261).
 * Phase 2: detail + Expand with agent.
 * Phase 3: Investigate / Plan / Debug / Board workflow toolbar.
 * Phase 4: Git menu — branch, commits, PR via gh, GitHub URL chips.
 * Flat chrome; --mn-* tokens only.
 *
 * Peek is a description-first document: sticky identity + dispatch, then the
 * body, then compact add-rows for empty secondary sections.
 *
 * IMPECCABLE_PREFLIGHT: context=pass product=pass command_reference=not_required
 * shape=pass image_gate=skipped:harness lacks native image generation mutation=open
 */

import { setAssistantBubbleContent } from '../markdown/renderer';
import {
  appendIssueLinks,
  deleteIssue,
  findIssueById,
  issueCodeRefsEqual,
  scheduleSaveIssues,
  updateIssue,
} from '../state/issues-store';
import { parseIssueCodeRefPaste } from '../state/issue-code-ref-parse';
import { getWorkspacePath } from '../state/workspace';
import { getMode } from '../chat/modes/registry';
import {
  canExpandIssueWithAgent,
} from '../chat/issues/expand-task';
import {
  canInvestigateIssue,
  canRunIssueWorkflow,
  issueActivityChip,
  issueActivityTarget,
  openIssueActivity,
  runIssueBackgroundChat,
  runIssueExpandWithAgent,
  runIssueForegroundChat,
  runIssueSendToBoard,
  openIssuePlanInEditor,
  ISSUE_BACKGROUND_CHAT_MODES,
  ISSUE_FOREGROUND_CHAT_MODES,
} from '../chat/issues/pipeline';
import type { IssueBackgroundChatMode, IssueForegroundChatMode } from '../chat/issues/workflow-seeds';
import { createIssuesWorkflowDropdown, closeIssuesWorkflowMenu } from './issues-workflow-menu';
import {
  createBranchFromIssue,
  createPrFromIssue,
  detectGhAvailable,
  linkCommitToIssue,
  linkGitHubUrlToIssue,
  listIssueCommits,
  openExternalGitUrl,
  openIssueCommitInGitUi,
  resolveGitLinkOpenUrl,
  resolveIssuePrNumber,
} from '../chat/issues/git-actions';
import { listPrReviewsForIssue, subscribePrReviews } from '../state/pr-review-store';
import {
  applyPrReviewToIssue,
  mergeReviewedPr,
  sendPrReviewToBuilder,
} from '../chat/review/review-actions';
import { startPrReview } from '../chat/review/run-pr-review';
import { renderPrReviewPanel } from './pr-review-panel';
import { switchChat } from './sidebar';
import { createCodeRefLinkButton } from './code-ref-link';
import { createIssueEditor } from './issue-editor';
import { collectInlineRefs } from '../issues/markdown-inline';
import { codeRefsExcludingPlan, inferIssuePlanPath } from '../issues/plan-attach';
import { renderIssueAttachments } from './issues-attachments-section';
import { bindIssueDropTarget } from './issue-drop-target';
import { renderIssueGithubSection } from './issues-github-section';
import { createIssuesLabelsField, isIssuesLabelsFieldFocused } from './issues-labels-field';
import { appConfirm } from './app-dialog';
import { executeTool } from '../tools/client';
import { createIssueTypeChip } from '../issues/type-icons';
import {
  sortedPriorities,
  sortedStatuses,
  sortedTypes,
} from '../issues/taxonomy';
import { getIssuesTaxonomySync } from '../state/issues-taxonomy-store';
import { isLocalServerAvailable } from '../tools/config';
import { createIcon } from './icon';
import { openIssuesContextMenu } from './issues-context-menu';
import type {
  IssueCard,
  IssueCodeRef,
  IssueGitLink,
  IssueIssueRef,
  IssuePriority,
  IssueStatus,
  IssueType,
} from '../types';

/** Issue ids currently expanding via issue-writer. */
const expandingIds = new Set<string>();

/** Issue ids with a workflow action in flight (Investigate / Plan / …). */
const workflowBusyIds = new Set<string>();

/** Issue ids with a Git action in flight (branch / PR / link). */
const gitBusyIds = new Set<string>();

/** Last Git error per issue (survives detail re-render). */
const gitErrorByIssueId = new Map<string, string>();

let selectedIssueId: string | undefined;
let detailHost: HTMLElement | null = null;

subscribePrReviews(() => {
  if (selectedIssueId) refreshIssueDetailIfOpen();
});

function showIssuesToast(message: string, kind: 'success' | 'error' = 'success'): void {
  void import('./toast').then((m) => m.showToast(message, kind));
}

function ensureDetailHost(): HTMLElement | null {
  // Mount beside the list/board inside .issues-body so the slide-over shares that row.
  const body = document.querySelector('#issuesView .issues-body');
  if (!body) return null;
  let host = document.getElementById('issuesDetailHost');
  if (!host) {
    host = document.createElement('aside');
    host.id = 'issuesDetailHost';
    host.className = 'issues-detail-host';
    host.setAttribute('aria-label', 'Issue detail');
    body.appendChild(host);
  }
  detailHost = host;
  return host;
}

/** Currently open detail issue id (if any). */
export function getSelectedIssueId(): string | undefined {
  return selectedIssueId;
}

/**
 * True when focus is inside peek chrome that a remount would wipe.
 * Store subscriptions refresh the panel on every patch; skip that while the
 * title, description, labels, or an add-row field is being typed.
 */
export function isIssuesDetailEditing(): boolean {
  const active = document.activeElement;
  if (!active || typeof (active as { closest?: unknown }).closest !== 'function') {
    return false;
  }
  if (isIssuesLabelsFieldFocused()) return true;
  const el = active as HTMLElement;
  return Boolean(
    el.closest('.issues-detail__title') ||
      el.closest('.issues-detail__desc-wrap') ||
      el.closest('.mn-editor') ||
      el.closest('.issues-detail__add-code'),
  );
}

/** Whether an expand run is in flight for this issue. */
export function isIssueExpanding(issueId: string): boolean {
  return expandingIds.has(issueId);
}

function syncDetailLayoutClass(open: boolean): void {
  const root = document.getElementById('issuesView');
  root?.classList.toggle('has-detail', open);
  // @container rules match descendants of .issues-page, not the page itself.
  root?.querySelector('.issues-shell')?.classList.toggle('is-detail', open);
}

/** Close the detail panel and clear selection. */
export function closeIssueDetail(): void {
  selectedIssueId = undefined;
  const host = detailHost ?? document.getElementById('issuesDetailHost');
  if (host) {
    host.classList.remove('is-open');
    host.innerHTML = '';
  }
  syncDetailLayoutClass(false);
}

/** Delete the open issue after confirmation. */
async function deleteIssueFromDetail(issueId: string): Promise<void> {
  const ok = await appConfirm('Delete this issue? This cannot be undone.', {
    confirmLabel: 'Delete',
    title: 'Delete issue',
  });
  if (!ok) return;
  if (!deleteIssue(issueId)) return;
  closeIssueDetail();
  void import('./issues-page').then((m) => {
    m.setIssuesRouteHash('#/app/issues');
    m.renderIssuesPanel();
  });
}

/** Open (or refresh) the detail slide-over for an issue id. */
export function openIssueDetail(issueId: string): void {
  const issue = findIssueById(issueId);
  if (!issue) {
    closeIssueDetail();
    return;
  }
  selectedIssueId = issue.id;
  const host = ensureDetailHost();
  if (!host) return;
  syncDetailLayoutClass(true);
  host.classList.add('is-open');
  renderIssueDetail(host, issue);
}

/** Re-render detail if the selected issue is still open. */
export function refreshIssueDetailIfOpen(): void {
  closeIssuesWorkflowMenu();
  if (!selectedIssueId) return;
  openIssueDetail(selectedIssueId);
}

/** Capture a short snippet for a code ref via read_file_range when possible. */
async function captureSnippetForRef(ref: IssueCodeRef): Promise<string | undefined> {
  if (ref.snippet?.trim()) return ref.snippet;
  if (ref.startLine == null) return undefined;
  const start = ref.startLine;
  const end = ref.endLine ?? start;
  try {
    const raw = (
      await executeTool('read_file_range', {
        path: ref.path,
        start_line: start,
        end_line: Math.min(end, start + 40),
      })
    ).content;
    if (typeof raw !== 'string' || raw.startsWith('Error:')) return undefined;
    // Strip "N: " line prefixes from tool output when present.
    const body = raw
      .split('\n')
      .map((line) => line.replace(/^\s*\d+:\s?/, ''))
      .join('\n')
      .trim();
    return body.slice(0, 2000) || undefined;
  } catch {
    return undefined;
  }
}

async function addCodeRefFromPaste(issueId: string, paste: string): Promise<void> {
  const parsed = parseIssueCodeRefPaste(paste);
  if (parsed.ok === false) {
    void import('./toast').then((m) => m.showToast(parsed.error, 'error'));
    return;
  }
  const snippet = await captureSnippetForRef(parsed.ref);
  const ref: IssueCodeRef = snippet ? { ...parsed.ref, snippet } : parsed.ref;
  appendIssueLinks(issueId, { codeRefs: [ref] });
  scheduleSaveIssues();
  refreshIssueDetailIfOpen();
}

function removeCodeRefFromIssue(issueId: string, ref: IssueCodeRef): void {
  const issue = findIssueById(issueId);
  if (!issue?.codeRefs?.length) return;
  const next = issue.codeRefs.filter((entry) => !issueCodeRefsEqual(entry, ref));
  if (next.length === issue.codeRefs.length) return;
  updateIssue(issueId, { codeRefs: next });
  scheduleSaveIssues();
  refreshIssueDetailIfOpen();
}

/** Unlink a plan markdown path from the issue (does not delete the file). */
function removePlanFromIssue(issueId: string, planPath: string): void {
  const issue = findIssueById(issueId);
  if (!issue) return;
  const hadExplicitPlan = Boolean(issue.planPath?.trim());
  const nextCodeRefs = codeRefsExcludingPlan(issue.codeRefs ?? [], planPath);
  const codeRefsChanged = nextCodeRefs.length !== (issue.codeRefs?.length ?? 0);
  if (!hadExplicitPlan && !codeRefsChanged) return;
  const patch: Parameters<typeof updateIssue>[1] = {};
  if (hadExplicitPlan) patch.planPath = '';
  if (codeRefsChanged) patch.codeRefs = nextCodeRefs;
  updateIssue(issueId, patch);
  scheduleSaveIssues();
  refreshIssueDetailIfOpen();
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

type DetailSectionOptions = {
  /** No heading — the description is the page, activity is a caption. */
  untitled?: boolean;
  /** One-line add row: heading (if any) sits beside the control. */
  compact?: boolean;
  variant?: 'document' | 'meta';
};

function section(
  title: string | null,
  options: DetailSectionOptions = {},
): { section: HTMLElement; body: HTMLElement } {
  const sectionEl = document.createElement('section');
  sectionEl.className = 'issues-detail__section';
  if (options.compact) sectionEl.classList.add('issues-detail__section--compact');
  if (options.variant) sectionEl.classList.add(`issues-detail__section--${options.variant}`);
  if (title && !options.untitled) {
    const h = document.createElement('h3');
    h.className = 'issues-detail__section-title';
    if (options.compact) h.classList.add('issues-detail__section-title--inline');
    h.textContent = title;
    sectionEl.appendChild(h);
  }
  const body = document.createElement('div');
  body.className = 'issues-detail__section-body';
  sectionEl.appendChild(body);
  return { section: sectionEl, body };
}

/** Icon button used for Close and the more menu — 28px visual, 44px on coarse pointers. */
function detailIconButton(label: string, iconName: 'close' | 'more'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'issues-detail__icon-btn';
  btn.setAttribute('aria-label', label);
  btn.appendChild(createIcon(iconName, { size: 16 }));
  return btn;
}

/**
 * Make a list-style chip a keyboard-openable property control.
 * Peek uses the same menu primitive as the row so type/status/priority do not
 * invent a second select vocabulary.
 */
function bindPropertyChip(
  chip: HTMLElement,
  ariaLabel: string,
  open: (anchor: HTMLElement) => void,
): void {
  chip.classList.add('issues-detail__prop');
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-haspopup', 'menu');
  chip.setAttribute('aria-label', ariaLabel);
  // Chevron signals the shared context menu — same affordance as workflow split buttons.
  chip.appendChild(
    createIcon('chevronDown', { size: 10, className: 'issues-detail__prop-chevron' }),
  );
  const show = (): void => open(chip);
  chip.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    show();
  });
  chip.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    show();
  });
}

function openDetailPropertyMenu(
  anchor: HTMLElement,
  label: string,
  items: Array<{ id: string; label: string }>,
  onPick: (id: string) => void,
): void {
  openIssuesContextMenu({
    anchor,
    restoreFocus: anchor,
    label,
    items: items.map((item) => ({
      id: item.id,
      label: item.label,
      onSelect: () => onPick(item.id),
    })),
  });
}

function createDetailStatusChip(status: IssueStatus): HTMLElement {
  const taxonomy = getIssuesTaxonomySync();
  const item = taxonomy.statuses.find((entry) => entry.id === status);
  const chip = document.createElement('span');
  chip.className = `issues-status-chip issues-status-chip--${status}`;
  chip.textContent = item?.label ?? `${status.replace(/_/g, ' ')} (unknown)`;
  if (item?.color) chip.style.setProperty('--issues-chip-color', item.color);
  chip.classList.toggle('is-unknown', !item);
  return chip;
}

function createDetailPriorityChip(priority: IssuePriority): HTMLElement {
  const taxonomy = getIssuesTaxonomySync();
  const item = taxonomy.priorities.find((entry) => entry.id === priority);
  const chip = document.createElement('span');
  chip.className = `issues-priority-chip issues-priority-chip--${priority}`;
  chip.textContent = item?.label ?? (priority === 'none' ? 'None' : priority);
  if (item?.color) chip.style.setProperty('--issues-chip-color', item.color);
  chip.classList.toggle('is-unknown', !item);
  return chip;
}

/** Input + submit used by code links and git paste rows. */
function buildAddRow(
  input: HTMLInputElement,
  button: HTMLButtonElement,
  extraClass?: string,
): HTMLElement {
  const addRow = document.createElement('div');
  addRow.className = extraClass
    ? `issues-detail__add-code ${extraClass}`
    : 'issues-detail__add-code';
  addRow.append(input, button);
  return addRow;
}

/**
 * Description: the WYSIWYG editor over canonical markdown.
 *
 * Always live rather than click-to-edit. The Phase 1 surface swapped a rendered
 * preview for a raw textarea on click, which meant every edit started by
 * looking at markdown source — the opposite of what the editor is for. The
 * editor renders and edits in the same place, and writes markdown on commit.
 *
 * Mentions written in the body become real links (`issueRefs`, `codeRefs`) so
 * `#KEY-12` and `@src/foo.ts:12` are data, not text.
 */
function buildDescriptionSection(issue: IssueCard): HTMLElement {
  // No "Description" heading — the editor *is* the page.
  const descSection = section(null, { untitled: true, variant: 'document' });
  const host = document.createElement('div');
  host.className = 'issues-detail__desc-wrap';

  let lastCommitted = findIssueById(issue.id)?.description ?? issue.description;

  createIssueEditor(host, {
    value: lastCommitted,
    issueId: issue.id,
    placeholder: 'Describe the problem. / for blocks, # for issues, @ for files.',
    onChange: (markdown) => {
      if (markdown === lastCommitted) return;
      lastCommitted = markdown;
      updateIssue(issue.id, { description: markdown });
      syncDescriptionRefs(issue.id, markdown);
      scheduleSaveIssues();
    },
  });

  descSection.body.appendChild(host);
  return descSection.section;
}

/**
 * Turn `#KEY-12` and `@path:12-34` in the body into real links.
 *
 * Append-only, and it never removes a link when a mention is deleted: a link
 * may also have been added by capture, an agent, or the Git section, and this
 * has no way to tell which. Removing a link stays an explicit action.
 */
function syncDescriptionRefs(issueId: string, markdown: string): void {
  const refs = collectInlineRefs(markdown);
  if (refs.issueIds.length === 0 && refs.codeRefs.length === 0) return;

  appendIssueLinks(issueId, {
    issueRefs: refs.issueIds
      .filter((id) => id !== issueId && findIssueById(id))
      .map((id) => ({ issueId: id, kind: 'related' as const, addedAt: Date.now() })),
    codeRefs: refs.codeRefs,
  });
}

/** Build the detail panel DOM for one issue. */
function renderIssueDetail(host: HTMLElement, issue: IssueCard): void {
  host.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'issues-detail';
  panel.dataset.issueId = issue.id;

  const sticky = document.createElement('div');
  sticky.className = 'issues-detail__sticky';

  const header = document.createElement('header');
  header.className = 'issues-detail__header';

  const idEl = document.createElement('span');
  idEl.className = 'issues-detail__id';
  idEl.textContent = issue.id;

  const headerActions = document.createElement('div');
  headerActions.className = 'issues-detail__header-actions';

  const moreBtn = detailIconButton('Issue actions', 'more');
  moreBtn.classList.add('issues-detail__more');
  moreBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    openIssuesContextMenu({
      anchor: moreBtn,
      restoreFocus: moreBtn,
      label: 'Issue actions',
      items: [
        {
          id: 'delete',
          label: 'Delete issue',
          danger: true,
          onSelect: () => {
            void deleteIssueFromDetail(issue.id);
          },
        },
      ],
    });
  });

  const closeBtn = detailIconButton('Close issue detail', 'close');
  closeBtn.classList.add('issues-detail__close');
  closeBtn.addEventListener('click', () => {
    closeIssueDetail();
    // Embedded Code host keeps `#/app/code/...` — do not jump to fullscreen Issues.
    void import('./issues-page').then((m) => m.setIssuesRouteHash('#/app/issues'));
  });

  headerActions.append(moreBtn, closeBtn);
  header.append(idEl, headerActions);
  sticky.appendChild(header);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'issues-detail__title';
  titleInput.value = issue.title;
  titleInput.setAttribute('aria-label', 'Issue title');
  titleInput.addEventListener('change', () => {
    const next = titleInput.value.trim();
    if (next && next !== issue.title) updateIssue(issue.id, { title: next });
  });
  sticky.appendChild(titleInput);

  const props = document.createElement('div');
  props.className = 'issues-detail__props';
  const taxonomy = getIssuesTaxonomySync();

  const typeChip = createIssueTypeChip(
    issue.type,
    taxonomy.types.find((entry) => entry.id === issue.type),
    { labeled: true },
  );
  bindPropertyChip(typeChip, `Type: ${typeChip.title || issue.type}`, (anchor) => {
    openDetailPropertyMenu(
      anchor,
      'Type',
      sortedTypes(taxonomy).map((entry) => ({ id: entry.id, label: entry.label })),
      (id) => updateIssue(issue.id, { type: id as IssueType }),
    );
  });

  const statusChip = createDetailStatusChip(issue.status);
  bindPropertyChip(statusChip, `Status: ${statusChip.textContent || issue.status}`, (anchor) => {
    openDetailPropertyMenu(
      anchor,
      'Status',
      sortedStatuses(taxonomy).map((entry) => ({ id: entry.id, label: entry.label })),
      (id) => updateIssue(issue.id, { status: id as IssueStatus }),
    );
  });

  const priorityChip = createDetailPriorityChip(issue.priority);
  bindPropertyChip(
    priorityChip,
    `Priority: ${priorityChip.textContent || issue.priority}`,
    (anchor) => {
      openDetailPropertyMenu(
        anchor,
        'Priority',
        sortedPriorities(taxonomy).map((entry) => ({ id: entry.id, label: entry.label })),
        (id) => updateIssue(issue.id, { priority: id as IssuePriority }),
      );
    },
  );

  props.append(typeChip, statusChip, priorityChip);
  sticky.appendChild(props);

  const labelsField = createIssuesLabelsField({
    issueId: issue.id,
    labels: issue.labels,
    severity: issue.severity,
    variant: 'detail',
    onChange: (labels) => {
      updateIssue(issue.id, { labels });
    },
  });
  sticky.appendChild(labelsField);

  sticky.appendChild(buildWorkflowToolbar(issue));
  panel.appendChild(sticky);

  const scroll = document.createElement('div');
  scroll.className = 'issues-detail__scroll';

  scroll.appendChild(buildDescriptionSection(issue));

  // Secondary blocks: filled sections get a heading; empty ones collapse to
  // one add-row so the description stays the page.
  const planPath = inferIssuePlanPath(issue);
  scroll.appendChild(buildCodeLinksSection(issue, planPath));

  const githubHasLink = Boolean(issue.github);
  const githubSection = section(githubHasLink ? 'GitHub' : null, {
    untitled: !githubHasLink,
    compact: !githubHasLink,
  });
  if (renderIssueGithubSection(githubSection.body, issue, () => refreshIssueDetailIfOpen())) {
    scroll.appendChild(githubSection.section);
  }

  const attachmentCount = issue.attachments?.length ?? 0;
  const attachmentsSection = section(attachmentCount > 0 ? 'Attachments' : null, {
    untitled: attachmentCount === 0,
    compact: attachmentCount === 0,
  });
  renderIssueAttachments(attachmentsSection.body, issue, () => refreshIssueDetailIfOpen());
  scroll.appendChild(attachmentsSection.section);

  if (planPath) {
    scroll.appendChild(buildPlanSection(issue, planPath));
  }

  scroll.appendChild(buildGitSection(issue));

  const reviewSection = buildIssueReviewSection(issue);
  if (reviewSection) scroll.appendChild(reviewSection);

  const related = buildRelatedIssuesSection(issue);
  if (related) scroll.appendChild(related);

  scroll.appendChild(buildActivityFooter(issue));

  panel.appendChild(scroll);
  bindIssueDropTarget(panel, issue.id, () => refreshIssueDetailIfOpen());
  host.appendChild(panel);
}

function buildCodeAddRow(issueId: string): HTMLElement {
  const pasteInput = document.createElement('input');
  pasteInput.type = 'text';
  pasteInput.className = 'issues-search';
  pasteInput.placeholder = 'Add code link…';
  pasteInput.setAttribute('aria-label', 'Paste code link');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'issues-btn';
  addBtn.textContent = 'Add';
  const submitPaste = (): void => {
    const value = pasteInput.value.trim();
    if (!value) return;
    void addCodeRefFromPaste(issueId, value).then(() => {
      pasteInput.value = '';
    });
  };
  addBtn.addEventListener('click', submitPaste);
  pasteInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitPaste();
  });
  return buildAddRow(pasteInput, addBtn);
}

function buildCodeLinksSection(issue: IssueCard, planPath: string | undefined): HTMLElement {
  const refs = codeRefsExcludingPlan(issue.codeRefs ?? [], planPath);
  const empty = refs.length === 0;
  const codeSection = section(empty ? null : 'Code links', {
    untitled: empty,
    compact: empty,
  });

  if (!empty) {
    const list = document.createElement('div');
    list.className = 'issues-detail__code-list';
    for (const ref of refs) {
      const row = document.createElement('div');
      row.className = 'issues-detail__code-row';

      const main = document.createElement('div');
      main.className = 'issues-detail__code-row-main';

      const btn = createCodeRefLinkButton({
        workspacePath: ref.path,
        startLine: ref.startLine ?? 1,
        endLine: ref.endLine ?? ref.startLine ?? 1,
      });
      main.appendChild(btn);
      if (ref.snippet?.trim()) {
        const snip = document.createElement('pre');
        snip.className = 'issues-detail__snippet';
        snip.textContent = ref.snippet.slice(0, 500);
        main.appendChild(snip);
      }
      row.appendChild(main);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'issues-detail__code-remove';
      remove.setAttribute('aria-label', `Remove link to ${ref.path}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        removeCodeRefFromIssue(issue.id, ref);
      });
      row.appendChild(remove);

      list.appendChild(row);
    }
    codeSection.body.appendChild(list);
  }

  codeSection.body.appendChild(buildCodeAddRow(issue.id));
  return codeSection.section;
}

function buildPlanSection(issue: IssueCard, planPath: string): HTMLElement {
  const planSection = section('Plan');

  const planRow = document.createElement('div');
  planRow.className = 'issues-detail__plan-row';

  const planText = document.createElement('p');
  planText.className = 'issues-detail__plan-path';
  planText.textContent = planPath;
  planRow.appendChild(planText);

  const removePlan = document.createElement('button');
  removePlan.type = 'button';
  removePlan.className = 'issues-detail__code-remove';
  removePlan.setAttribute('aria-label', `Remove plan ${planPath}`);
  removePlan.textContent = '×';
  removePlan.addEventListener('click', () => {
    removePlanFromIssue(issue.id, planPath);
  });
  planRow.appendChild(removePlan);
  planSection.body.appendChild(planRow);

  const planActions = document.createElement('div');
  planActions.className = 'issues-detail__plan-actions';

  const openPlan = document.createElement('button');
  openPlan.type = 'button';
  openPlan.className = 'issues-btn';
  openPlan.textContent = 'Open plan';
  openPlan.addEventListener('click', () => {
    void openIssuePlanInEditor(planPath, issue.workspacePath);
  });
  planActions.appendChild(openPlan);

  const workflowOk = canRunIssueWorkflow(issue);
  const workflowBusy = workflowBusyIds.has(issue.id) || expandingIds.has(issue.id);
  const boardBtn = document.createElement('button');
  boardBtn.type = 'button';
  boardBtn.className = 'issues-btn';
  boardBtn.disabled = !workflowOk || workflowBusy;
  boardBtn.textContent = 'Send to board';
  boardBtn.title = workflowOk
    ? 'Launch an Orchestrate board from the issue plan'
    : 'Issue is closed';
  boardBtn.addEventListener('click', () => {
    void runWorkflowAction(issue.id, 'board');
  });
  planActions.appendChild(boardBtn);
  planSection.body.appendChild(planActions);
  return planSection.section;
}

function buildActivityFooter(issue: IssueCard): HTMLElement {
  const activitySection = section(null, { untitled: true, variant: 'meta' });
  const ws = issue.workspacePath || getWorkspacePath();
  const activity = document.createElement('p');
  activity.className = 'issues-detail__meta-line';
  activity.textContent = `Created ${formatTs(issue.createdAt)} · Updated ${formatTs(issue.updatedAt)}`;
  activitySection.body.appendChild(activity);
  if (ws) {
    const workspace = document.createElement('p');
    workspace.className = 'issues-detail__meta-line';
    workspace.textContent = ws;
    activitySection.body.appendChild(workspace);
  }
  const chatBits: string[] = [];
  if (issue.chatIds?.length) chatBits.push(`${issue.chatIds.length} chat(s)`);
  if (issue.boardChatId) chatBits.push(`board ${issue.boardChatId.slice(0, 8)}…`);
  if (issue.investigateRunId) chatBits.push(`run ${issue.investigateRunId.slice(0, 8)}…`);
  if (issue.planRunId) chatBits.push(`plan ${issue.planRunId.slice(0, 8)}…`);
  if (chatBits.length) {
    const chats = document.createElement('p');
    chats.className = 'issues-detail__meta-line';
    chats.textContent = chatBits.join(' · ');
    activitySection.body.appendChild(chats);
  }
  if (issue.notes?.trim()) {
    const notes = document.createElement('div');
    notes.className = 'issues-detail__notes';
    notes.textContent = issue.notes;
    activitySection.body.appendChild(notes);
  }
  return activitySection.section;
}

/** Shared review panel when this issue has a persisted PR review. */
function buildIssueReviewSection(issue: IssueCard): HTMLElement | null {
  const records = listPrReviewsForIssue(issue.id);
  if (!records.length) return null;
  const record = [...records].sort((a, b) => b.startedAt - a.startedAt)[0]!;
  const reviewSection = section('Review');
  renderPrReviewPanel(reviewSection.body, record, {
    showUpdateIssue: true,
    onMerge: () => {
      void mergeReviewedPr(record, issue.workspacePath || getWorkspacePath()).then((outcome) => {
        if (outcome.cancelled) return;
        if (!outcome.ok) {
          showIssuesToast(outcome.error ?? 'Could not merge the pull request', 'error');
          return;
        }
        showIssuesToast(`Merged #${record.number}`, 'success');
      });
    },
    onFix: () => {
      void sendPrReviewToBuilder(record);
    },
    onUpdateIssue: () => {
      if (applyPrReviewToIssue(record, issue.id)) {
        showIssuesToast('Issue updated with the review', 'success');
        refreshIssueDetailIfOpen();
      }
    },
    onOpenChat: () => {
      if (record.chatId) void switchChat(record.chatId);
    },
    onRetry: () => {
      void runGitAction(issue.id, 'review');
    },
  });
  return reviewSection.section;
}

/** Restrained Git menu + linked chips + commit grep list for the detail panel. */
function buildGitSection(issue: IssueCard): HTMLElement {
  const gitLinks = issue.gitLinks ?? [];
  const empty = gitLinks.length === 0;
  const gitSection = section(empty ? null : 'Git', {
    untitled: empty,
    compact: empty,
  });
  const body = gitSection.body;
  const busy = gitBusyIds.has(issue.id);

  const errEl = document.createElement('p');
  errEl.className = 'issues-detail__git-error';
  errEl.setAttribute('role', 'alert');
  const storedErr = gitErrorByIssueId.get(issue.id);
  if (storedErr) {
    errEl.hidden = false;
    errEl.textContent = storedErr;
  } else {
    errEl.hidden = true;
  }

  // Action row (Create branch / Create PR / paste helpers)
  const menu = document.createElement('div');
  menu.className = 'issues-detail__git-menu';
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', 'Issue git actions');

  const branchBtn = document.createElement('button');
  branchBtn.type = 'button';
  branchBtn.className = 'issues-btn';
  branchBtn.disabled = busy;
  branchBtn.textContent = busy ? 'Working…' : 'Create branch';
  branchBtn.title = 'Create and checkout issue/<id>-<slug>';
  branchBtn.addEventListener('click', () => {
    void runGitAction(issue.id, 'branch');
  });

  const prBtn = document.createElement('button');
  prBtn.type = 'button';
  prBtn.className = 'issues-btn';
  prBtn.disabled = busy;
  prBtn.hidden = true; // shown after gh detect
  prBtn.textContent = busy ? 'Working…' : 'Create PR';
  prBtn.title = 'Open a pull request with gh from the issue branch';
  prBtn.addEventListener('click', () => {
    void runGitAction(issue.id, 'pr');
  });

  const reviewing = listPrReviewsForIssue(issue.id).some((row) => row.status === 'running');
  const reviewBtn = document.createElement('button');
  reviewBtn.type = 'button';
  reviewBtn.className = 'issues-btn';
  reviewBtn.hidden = true;
  reviewBtn.disabled = busy || reviewing;
  reviewBtn.textContent = reviewing ? 'Reviewing…' : busy ? 'Working…' : 'Review PR';
  reviewBtn.title = 'Review the linked pull request in a dedicated chat';
  reviewBtn.addEventListener('click', () => {
    void runGitAction(issue.id, 'review');
  });

  const linkToggle = document.createElement('button');
  linkToggle.type = 'button';
  linkToggle.className = 'issues-btn issues-detail__git-link-toggle';
  linkToggle.textContent = 'Link…';
  linkToggle.setAttribute('aria-expanded', 'false');
  linkToggle.setAttribute('aria-controls', `issues-git-link-fields-${issue.id}`);

  menu.append(branchBtn, prBtn, reviewBtn, linkToggle);
  body.append(menu, errEl);

  if (!empty) {
    const chipList = document.createElement('ul');
    chipList.className = 'issues-detail__git-list';
    for (const link of gitLinks) {
      chipList.appendChild(buildGitLinkRow(link));
    }
    body.appendChild(chipList);
  }

  // Commits subsection
  const commitsHead = document.createElement('h4');
  commitsHead.className = 'issues-detail__git-subhead';
  commitsHead.textContent = 'Commits';
  commitsHead.hidden = true;
  const commitsHost = document.createElement('div');
  commitsHost.className = 'issues-detail__git-commits';
  commitsHost.hidden = true;
  body.append(commitsHead, commitsHost);

  const shaInput = document.createElement('input');
  shaInput.type = 'text';
  shaInput.className = 'issues-search';
  shaInput.placeholder = 'Link commit sha…';
  shaInput.setAttribute('aria-label', 'Commit sha');
  const shaBtn = document.createElement('button');
  shaBtn.type = 'button';
  shaBtn.className = 'issues-btn';
  shaBtn.textContent = 'Link commit';
  shaBtn.disabled = busy;
  const submitSha = (): void => {
    const value = shaInput.value;
    shaInput.value = '';
    void runGitAction(issue.id, 'link-commit', value);
  };
  shaBtn.addEventListener('click', submitSha);
  shaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitSha();
    }
  });

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.className = 'issues-search';
  urlInput.placeholder = 'Paste GitHub issue or PR URL…';
  urlInput.setAttribute('aria-label', 'GitHub issue or PR URL');
  const urlBtn = document.createElement('button');
  urlBtn.type = 'button';
  urlBtn.className = 'issues-btn';
  urlBtn.textContent = 'Link URL';
  urlBtn.disabled = busy;
  const submitUrl = (): void => {
    const value = urlInput.value;
    urlInput.value = '';
    void runGitAction(issue.id, 'link-url', value);
  };
  urlBtn.addEventListener('click', submitUrl);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitUrl();
    }
  });

  const linkFields = document.createElement('div');
  linkFields.id = `issues-git-link-fields-${issue.id}`;
  linkFields.className = 'issues-detail__git-link-fields';
  linkFields.hidden = true;
  linkFields.append(buildAddRow(shaInput, shaBtn), buildAddRow(urlInput, urlBtn));
  body.appendChild(linkFields);

  linkToggle.addEventListener('click', () => {
    const next = linkFields.hidden;
    linkFields.hidden = !next;
    linkToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) shaInput.focus();
  });

  // gh detect and commit grep need the tool server. Skip the round-trip when
  // it is down rather than leaving Create PR and Commits in a loading void.
  if (!isLocalServerAvailable()) {
    return gitSection.section;
  }

  void (async () => {
    const hasGh = await detectGhAvailable();
    if (selectedIssueId !== issue.id) return;
    if (hasGh) {
      prBtn.hidden = false;
      const resolved = await resolveIssuePrNumber(issue);
      if (selectedIssueId !== issue.id) return;
      if (resolved) reviewBtn.hidden = false;
    } else {
      prBtn.hidden = true;
      reviewBtn.hidden = true;
      prBtn.title = 'Install and authenticate GitHub CLI (gh) to create PRs';
    }

    const listed = await listIssueCommits(issue);
    if (selectedIssueId !== issue.id) return;
    commitsHost.innerHTML = '';
    if (!listed.ok || listed.commits.length === 0) {
      commitsHead.hidden = true;
      commitsHost.hidden = true;
      return;
    }
    commitsHead.hidden = false;
    commitsHost.hidden = false;
    const ul = document.createElement('ul');
    ul.className = 'issues-detail__git-list';
    for (const c of listed.commits) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'issues-detail__git-commit-btn';
      btn.title = 'Open in git panel';
      const shaSpan = document.createElement('span');
      shaSpan.className = 'issues-detail__git-sha';
      shaSpan.textContent = c.sha.slice(0, 7);
      const subSpan = document.createElement('span');
      subSpan.textContent = c.subject;
      btn.append(shaSpan, subSpan);
      btn.addEventListener('click', () => {
        void openIssueCommitInGitUi(c.sha, c.subject);
      });
      li.appendChild(btn);
      ul.appendChild(li);
    }
    commitsHost.appendChild(ul);
  })();

  return gitSection.section;
}

const ISSUE_RELATION_LABELS: Record<IssueIssueRef['kind'], string> = {
  related: 'Related',
  blocks: 'Blocks',
  'blocked-by': 'Blocked by',
  'duplicate-of': 'Duplicate of',
  parent: 'Parent',
  'sub-issue': 'Sub-issue',
};

/** Related issue chips with deep links to other cards. */
function buildRelatedIssuesSection(issue: IssueCard): HTMLElement | null {
  const refs = issue.issueRefs ?? [];
  if (refs.length === 0) return null;

  const relatedSection = section('Related issues');
  const list = document.createElement('ul');
  list.className = 'issues-detail__related-list';
  for (const ref of refs) {
    list.appendChild(buildRelatedIssueChip(ref));
  }
  relatedSection.body.appendChild(list);
  return relatedSection.section;
}

/** One clickable related-issue chip. */
function buildRelatedIssueChip(ref: IssueIssueRef): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'issues-detail__related-chip';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'issues-detail__related-chip-btn';
  const target = findIssueById(ref.issueId);
  const kindLabel = ISSUE_RELATION_LABELS[ref.kind] ?? ref.kind;
  const titleBit = target?.title?.trim() ? ` · ${target.title.trim()}` : '';
  btn.textContent = `${kindLabel} · ${ref.issueId}${titleBit}`;
  btn.title = `Open ${ref.issueId}`;
  btn.addEventListener('click', () => {
    openIssueDetail(ref.issueId);
    void import('./issues-page').then((m) => m.setIssuesRouteHash(`#/app/issues/${ref.issueId}`));
  });
  li.appendChild(btn);
  return li;
}

/** One git link chip row with optional Open on GitHub. */
function buildGitLinkRow(link: IssueGitLink): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'issues-detail__git-chip';

  const label = document.createElement('span');
  label.className = 'issues-detail__git-chip-label';
  const kindLabel =
    link.kind === 'github-issue' ? 'GH issue' : link.kind === 'pr' ? 'PR' : link.kind;
  label.textContent = link.title?.trim() || `${kindLabel}: ${link.ref}`;
  li.appendChild(label);

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'issues-btn issues-detail__git-open';
  openBtn.textContent = link.kind === 'commit' ? 'Open' : 'Open on GitHub';
  openBtn.addEventListener('click', () => {
    void (async () => {
      if (link.kind === 'commit') {
        await openIssueCommitInGitUi(link.ref, link.title);
        return;
      }
      const url = await resolveGitLinkOpenUrl(link);
      if (!url) {
        showIssuesToast('No web URL for this link', 'error');
        return;
      }
      openExternalGitUrl(url);
    })();
  });
  li.appendChild(openBtn);
  return li;
}

type GitUiAction = 'branch' | 'pr' | 'review' | 'link-commit' | 'link-url';

/** Persist error or toast success from a Git action result. */
function applyGitActionResult(
  issueId: string,
  result: { ok: boolean; message?: string; error?: string },
  fallbackOk: string,
): void {
  // Prefer explicit ok===false — discriminant narrowing is unreliable with strict:false.
  if (result.ok === false) {
    gitErrorByIssueId.set(issueId, result.error || 'Git action failed');
    return;
  }
  showIssuesToast(result.message || fallbackOk, 'success');
}

async function runGitAction(
  issueId: string,
  action: GitUiAction,
  input?: string,
): Promise<void> {
  if (gitBusyIds.has(issueId)) return;
  const issue = findIssueById(issueId);
  if (!issue) {
    gitErrorByIssueId.set(issueId, 'Issue not found');
    refreshIssueDetailIfOpen();
    return;
  }
  gitBusyIds.add(issueId);
  gitErrorByIssueId.delete(issueId);
  refreshIssueDetailIfOpen();
  try {
    if (action === 'branch') {
      const result = await createBranchFromIssue(issue);
      applyGitActionResult(issueId, result, 'Branch ready');
      return;
    }
    if (action === 'pr') {
      const result = await createPrFromIssue(issue);
      applyGitActionResult(issueId, result, 'PR created');
      return;
    }
    if (action === 'review') {
      const resolved = await resolveIssuePrNumber(issue);
      if (!resolved) {
        applyGitActionResult(issueId, { ok: false, error: 'No pull request to review' }, '');
        return;
      }
      const started = await startPrReview({
        cwd: issue.workspacePath || getWorkspacePath(),
        repo: resolved.repo,
        number: resolved.number,
        issueId: issue.id,
      });
      applyGitActionResult(
        issueId,
        started.ok
          ? { ok: true, message: `Reviewing #${resolved.number}` }
          : { ok: false, error: started.error },
        'Review started',
      );
      return;
    }
    if (action === 'link-commit') {
      const result = await linkCommitToIssue(issueId, input ?? '');
      applyGitActionResult(issueId, result, 'Commit linked');
      return;
    }
    const result = await linkGitHubUrlToIssue(issueId, input ?? '');
    applyGitActionResult(issueId, result, 'URL linked');
  } finally {
    gitBusyIds.delete(issueId);
    refreshIssueDetailIfOpen();
  }
}

/** Build the restrained workflow toolbar for the detail panel. */
function buildWorkflowToolbar(issue: IssueCard): HTMLElement {
  const row = document.createElement('div');
  row.className = 'issues-detail__workflow';
  row.setAttribute('role', 'toolbar');
  row.setAttribute('aria-label', 'Issue workflow');

  const busy = workflowBusyIds.has(issue.id) || expandingIds.has(issue.id);
  const workflowOk = canRunIssueWorkflow(issue);
  const activity = issueActivityChip(issue);
  const activityTarget = issueActivityTarget(issue);

  const primary = document.createElement('div');
  primary.className = 'issues-detail__workflow-primary';

  if (activity) {
    const chip = document.createElement(
      activityTarget ? 'button' : 'span',
    ) as HTMLButtonElement | HTMLSpanElement;
    chip.className = 'issues-detail__activity-chip';
    if (activityTarget) {
      chip.classList.add('issues-detail__activity-chip--interactive');
      if (chip instanceof HTMLButtonElement) {
        chip.type = 'button';
        chip.title =
          activityTarget.kind === 'board_chat'
            ? 'Open board chat'
            : 'View sub-agent chat';
        chip.addEventListener('click', () => {
          void openIssueActivity(issue).then((ok) => {
            if (!ok) showIssuesToast('Could not open activity', 'error');
          });
        });
      }
    }
    chip.textContent = activity;
    primary.appendChild(chip);
  }

  if (canExpandIssueWithAgent(issue)) {
    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'issues-btn issues-btn--primary';
    expandBtn.disabled = expandingIds.has(issue.id);
    expandBtn.textContent = expandingIds.has(issue.id) ? 'Expanding…' : 'Expand';
    expandBtn.title = 'Flesh out this triage note with the issue-writer agent';
    expandBtn.addEventListener('click', () => {
      void startExpand(issue.id);
    });
    primary.appendChild(expandBtn);
  }

  row.appendChild(primary);

  const secondary = document.createElement('div');
  secondary.className = 'issues-detail__workflow-secondary';

  const foregroundHints: Record<IssueForegroundChatMode, string> = {
    general: 'Triage and discuss with full tool access',
    build: 'Implement or iterate on a fix',
    plan: 'Interactive planning chat in Code',
    debug: 'Reproduce and narrow root cause',
  };

  const foregroundItems = ISSUE_FOREGROUND_CHAT_MODES.map((modeId) => ({
    id: modeId,
    label: getMode(modeId).label,
    hint: foregroundHints[modeId],
    disabled: !workflowOk || busy,
    onSelect: () => {
      void runWorkflowAction(issue.id, 'foreground', modeId);
    },
  }));

  secondary.appendChild(
    createIssuesWorkflowDropdown({
      label: 'Send to chat',
      ariaLabel: 'Send issue to chat — choose mode',
      disabled: !workflowOk || busy,
      primary: true,
      items: foregroundItems,
    }),
  );

  const backgroundHints: Record<IssueBackgroundChatMode, string> = {
    debug: 'Debugger sub-agent investigates unattended',
    plan: 'Planner writes documentation/plans/issues/<id>.md',
  };

  const backgroundItems = ISSUE_BACKGROUND_CHAT_MODES.map((modeId) => ({
    id: modeId,
    label: getMode(modeId).label,
    hint: backgroundHints[modeId],
    disabled:
      !workflowOk ||
      busy ||
      (modeId === 'debug' && !canInvestigateIssue(issue)),
    onSelect: () => {
      void runWorkflowAction(issue.id, 'background', modeId);
    },
  }));

  secondary.appendChild(
    createIssuesWorkflowDropdown({
      label: 'Send to background',
      ariaLabel: 'Send issue to background chat — choose mode',
      disabled: !workflowOk || busy,
      items: backgroundItems,
    }),
  );

  row.appendChild(secondary);
  return row;
}

type WorkflowAction =
  | { kind: 'foreground'; modeId: IssueForegroundChatMode }
  | { kind: 'background'; modeId: IssueBackgroundChatMode }
  | { kind: 'board' };

async function runWorkflowAction(issueId: string, action: WorkflowAction['kind'], modeId?: IssueForegroundChatMode | IssueBackgroundChatMode): Promise<void> {
  if (workflowBusyIds.has(issueId)) return;
  workflowBusyIds.add(issueId);
  refreshIssueDetailIfOpen();
  try {
    if (action === 'foreground' && modeId) {
      const result = await runIssueForegroundChat(issueId, modeId as IssueForegroundChatMode);
      if (!result.ok) {
        showIssuesToast(result.error || 'Send to chat failed', 'error');
        return;
      }
      if (modeId === 'plan') {
        showIssuesToast(
          result.planPath ? `Plan chat · ${result.planPath}` : 'Plan chat opened',
          'success',
        );
      } else {
        showIssuesToast(`${getMode(modeId as IssueForegroundChatMode).label} chat opened`, 'success');
      }
      return;
    }
    if (action === 'background' && modeId) {
      const bgMode = modeId as IssueBackgroundChatMode;
      const result = await runIssueBackgroundChat(issueId, bgMode);
      if (!result.ok) {
        showIssuesToast(result.error || 'Send to background failed', 'error');
        return;
      }
      if (bgMode === 'debug') {
        showIssuesToast('Investigation started', 'success');
      } else {
        showIssuesToast(result.planPath ? `Plan: ${result.planPath}` : 'Plan ready', 'success');
      }
      return;
    }
    const result = await runIssueSendToBoard(issueId);
    if (!result.ok) showIssuesToast(result.error || 'Send to board failed', 'error');
    else showIssuesToast('Board started', 'success');
  } finally {
    workflowBusyIds.delete(issueId);
    refreshIssueDetailIfOpen();
  }
}

async function startExpand(issueId: string): Promise<void> {
  if (expandingIds.has(issueId)) return;
  expandingIds.add(issueId);
  refreshIssueDetailIfOpen();
  try {
    const result = await runIssueExpandWithAgent(issueId);
    if (!result.ok) {
      showIssuesToast(result.error || 'Expand failed', 'error');
    } else {
      showIssuesToast('Issue expanded', 'success');
    }
  } finally {
    expandingIds.delete(issueId);
    refreshIssueDetailIfOpen();
  }
}

/** Expand with agent from list/board row actions (shared with detail). */
export async function expandIssueFromUi(issueId: string): Promise<void> {
  await startExpand(issueId);
}
