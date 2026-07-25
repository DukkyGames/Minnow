/**
 * Issues detail slide-over / deep-link panel (MIN-261).
 * Phase 2: detail + Expand with agent.
 * Phase 3: Investigate / Plan / Debug / Board workflow toolbar.
 * Phase 4: Git menu — branch, commits, PR via gh, GitHub URL chips.
 * Flat chrome; --mn-* tokens only.
 *
 * IMPECCABLE_PREFLIGHT: context=pass product=pass command_reference=pass shape=pass
 * image_gate=skipped:harness lacks native image generation mutation=open
 */

import { setAssistantBubbleContent } from '../markdown/renderer';
import {
  appendIssueLinks,
  findIssueById,
  updateIssue,
} from '../state/issues-store';
import { parseIssueCodeRefPaste } from '../state/issue-code-ref-parse';
import { getWorkspacePath } from '../state/workspace';
import { canExpandIssueWithAgent } from '../chat/issues/expand-task';
import {
  canInvestigateIssue,
  canRunIssueWorkflow,
  canSendIssueToBoard,
  issueActivityChip,
  runIssueDebugChat,
  runIssueExpandWithAgent,
  runIssueInvestigate,
  runIssuePlanBackground,
  runIssuePlanChat,
  runIssueSendToBoard,
} from '../chat/issues/pipeline';
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
} from '../chat/issues/git-actions';
import { createCodeRefLinkButton } from './code-ref-link';
import { executeTool } from '../tools/client';
import type { IssueCard, IssueCodeRef, IssueGitLink, IssuePriority, IssueStatus, IssueType } from '../types';

const TYPE_OPTIONS: IssueType[] = ['bug', 'task', 'idea', 'note'];
const STATUS_OPTIONS: IssueStatus[] = [
  'triage',
  'backlog',
  'todo',
  'planned',
  'in_progress',
  'review',
  'done',
  'canceled',
];
const PRIORITY_OPTIONS: IssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

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

/** Whether an expand run is in flight for this issue. */
export function isIssueExpanding(issueId: string): boolean {
  return expandingIds.has(issueId);
}

/** Close the detail panel and clear selection. */
export function closeIssueDetail(): void {
  selectedIssueId = undefined;
  const host = detailHost ?? document.getElementById('issuesDetailHost');
  if (host) {
    host.classList.remove('is-open');
    host.innerHTML = '';
  }
  document.getElementById('issuesView')?.classList.remove('has-detail');
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
  document.getElementById('issuesView')?.classList.add('has-detail');
  host.classList.add('is-open');
  renderIssueDetail(host, issue);
}

/** Re-render detail if the selected issue is still open. */
export function refreshIssueDetailIfOpen(): void {
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
  refreshIssueDetailIfOpen();
}

function fillSelect(
  select: HTMLSelectElement,
  options: string[],
  value: string,
): void {
  select.innerHTML = '';
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt;
    el.textContent = opt.replace(/_/g, ' ');
    select.appendChild(el);
  }
  select.value = value;
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

function section(title: string): { section: HTMLElement; body: HTMLElement } {
  const sectionEl = document.createElement('section');
  sectionEl.className = 'issues-detail__section';
  const h = document.createElement('h3');
  h.className = 'issues-detail__section-title';
  h.textContent = title;
  const body = document.createElement('div');
  body.className = 'issues-detail__section-body';
  sectionEl.append(h, body);
  return { section: sectionEl, body };
}

/** Build the detail panel DOM for one issue. */
function renderIssueDetail(host: HTMLElement, issue: IssueCard): void {
  host.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'issues-detail';
  panel.dataset.issueId = issue.id;

  const header = document.createElement('header');
  header.className = 'issues-detail__header';

  const idEl = document.createElement('span');
  idEl.className = 'issues-detail__id';
  idEl.textContent = issue.id;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'issues-btn issues-detail__close';
  closeBtn.setAttribute('aria-label', 'Close issue detail');
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => {
    closeIssueDetail();
    const next = '#/app/issues';
    if (window.location.hash !== next) window.location.hash = next;
  });

  header.append(idEl, closeBtn);
  panel.appendChild(header);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'issues-detail__title';
  titleInput.value = issue.title;
  titleInput.setAttribute('aria-label', 'Issue title');
  titleInput.addEventListener('change', () => {
    const next = titleInput.value.trim();
    if (next && next !== issue.title) updateIssue(issue.id, { title: next });
  });
  panel.appendChild(titleInput);

  const props = document.createElement('div');
  props.className = 'issues-detail__props';

  const typeSel = document.createElement('select');
  typeSel.className = 'issues-filter';
  typeSel.setAttribute('aria-label', 'Type');
  fillSelect(typeSel, TYPE_OPTIONS, issue.type);
  typeSel.addEventListener('change', () => {
    updateIssue(issue.id, { type: typeSel.value as IssueType });
  });

  const statusSel = document.createElement('select');
  statusSel.className = 'issues-filter';
  statusSel.setAttribute('aria-label', 'Status');
  fillSelect(statusSel, STATUS_OPTIONS, issue.status);
  statusSel.addEventListener('change', () => {
    updateIssue(issue.id, { status: statusSel.value as IssueStatus });
  });

  const prioritySel = document.createElement('select');
  prioritySel.className = 'issues-filter';
  prioritySel.setAttribute('aria-label', 'Priority');
  fillSelect(prioritySel, PRIORITY_OPTIONS, issue.priority);
  prioritySel.addEventListener('change', () => {
    updateIssue(issue.id, { priority: prioritySel.value as IssuePriority });
  });

  props.append(typeSel, statusSel, prioritySel);
  panel.appendChild(props);

  if (issue.labels.length > 0 || issue.severity) {
    const labelsRow = document.createElement('div');
    labelsRow.className = 'issues-detail__labels';
    for (const label of issue.labels) {
      const chip = document.createElement('span');
      chip.className = 'issues-label';
      chip.textContent = label;
      labelsRow.appendChild(chip);
    }
    if (issue.severity) {
      const chip = document.createElement('span');
      chip.className = 'issues-label';
      chip.textContent = issue.severity;
      labelsRow.appendChild(chip);
    }
    panel.appendChild(labelsRow);
  }

  // Workflow toolbar (Expand + Investigate / Plan / Debug / Board)
  panel.appendChild(buildWorkflowToolbar(issue));

  const descSection = section('Description');
  const desc = document.createElement('div');
  desc.className = 'issues-detail__markdown msg-bubble msg-bubble--md';
  if (issue.description.trim()) {
    setAssistantBubbleContent(desc, issue.description);
  } else {
    desc.className = 'issues-detail__empty';
    desc.textContent = 'No description yet.';
  }
  descSection.body.appendChild(desc);
  panel.appendChild(descSection.section);

  // Code links
  const codeSection = section('Code links');
  const refs = issue.codeRefs ?? [];
  if (refs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'issues-detail__empty';
    empty.textContent = 'No code links yet.';
    codeSection.body.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'issues-detail__code-list';
    for (const ref of refs) {
      const row = document.createElement('div');
      row.className = 'issues-detail__code-row';
      const btn = createCodeRefLinkButton({
        workspacePath: ref.path,
        startLine: ref.startLine ?? 1,
        endLine: ref.endLine ?? ref.startLine ?? 1,
      });
      row.appendChild(btn);
      if (ref.snippet?.trim()) {
        const snip = document.createElement('pre');
        snip.className = 'issues-detail__snippet';
        snip.textContent = ref.snippet.slice(0, 500);
        row.appendChild(snip);
      }
      list.appendChild(row);
    }
    codeSection.body.appendChild(list);
  }

  const addRow = document.createElement('div');
  addRow.className = 'issues-detail__add-code';
  const pasteInput = document.createElement('input');
  pasteInput.type = 'text';
  pasteInput.className = 'issues-search';
  pasteInput.placeholder = 'path or path:12-34';
  pasteInput.setAttribute('aria-label', 'Paste code link');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'issues-btn';
  addBtn.textContent = 'Add link';
  const submitPaste = () => {
    const value = pasteInput.value.trim();
    if (!value) return;
    void addCodeRefFromPaste(issue.id, value).then(() => {
      pasteInput.value = '';
    });
  };
  addBtn.addEventListener('click', submitPaste);
  pasteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitPaste();
    }
  });
  addRow.append(pasteInput, addBtn);
  codeSection.body.appendChild(addRow);
  panel.appendChild(codeSection.section);

  // Chats & runs
  const chatsSection = section('Chats & runs');
  const chatBits: string[] = [];
  if (issue.chatIds?.length) chatBits.push(`${issue.chatIds.length} chat(s)`);
  if (issue.boardChatId) chatBits.push(`board: ${issue.boardChatId.slice(0, 8)}…`);
  if (issue.investigateRunId) chatBits.push(`run: ${issue.investigateRunId.slice(0, 8)}…`);
  if (issue.planRunId) chatBits.push(`plan run: ${issue.planRunId.slice(0, 8)}…`);
  const chatsEmpty = document.createElement('p');
  chatsEmpty.className = 'issues-detail__empty';
  chatsEmpty.textContent = chatBits.length ? chatBits.join(' · ') : 'No linked chats or runs yet.';
  chatsSection.body.appendChild(chatsEmpty);
  panel.appendChild(chatsSection.section);

  // Plan
  const planSection = section('Plan');
  const planEl = document.createElement('p');
  planEl.className = 'issues-detail__empty';
  if (issue.planPath?.trim()) {
    planEl.textContent = issue.planPath;
    const openPlan = document.createElement('button');
    openPlan.type = 'button';
    openPlan.className = 'issues-btn';
    openPlan.textContent = 'Open plan';
    openPlan.addEventListener('click', () => {
      void import('./file-viewer').then((m) => m.openFileInViewer(issue.planPath!));
    });
    planSection.body.append(planEl, openPlan);
  } else {
    planEl.textContent = 'No plan yet. Use Plan or Plan in background.';
    planSection.body.appendChild(planEl);
  }
  panel.appendChild(planSection.section);

  // Git — restrained menu + commits / chips (Phase 4)
  panel.appendChild(buildGitSection(issue));

  // Activity (lightweight timestamps)
  const activitySection = section('Activity');
  const activity = document.createElement('p');
  activity.className = 'issues-detail__empty';
  const ws = issue.workspacePath || getWorkspacePath();
  activity.textContent = `Created ${formatTs(issue.createdAt)} · Updated ${formatTs(issue.updatedAt)}${
    ws ? ` · ${ws}` : ''
  }`;
  activitySection.body.appendChild(activity);
  if (issue.notes?.trim()) {
    const notes = document.createElement('div');
    notes.className = 'issues-detail__notes';
    notes.textContent = issue.notes;
    activitySection.body.appendChild(notes);
  }
  panel.appendChild(activitySection.section);

  host.appendChild(panel);
}

/** Restrained Git menu + linked chips + commit grep list for the detail panel. */
function buildGitSection(issue: IssueCard): HTMLElement {
  const gitSection = section('Git');
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
  branchBtn.title = 'Create and checkout issue/iss-n-<slug>';
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

  menu.append(branchBtn, prBtn);
  body.append(menu, errEl);

  // Link chips (branch / pr / github-issue / commit)
  const gitLinks = issue.gitLinks ?? [];
  const chipList = document.createElement('ul');
  chipList.className = 'issues-detail__git-list';
  if (gitLinks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'issues-detail__empty';
    empty.textContent = 'No linked branches, PRs, or GitHub issues yet.';
    body.appendChild(empty);
  } else {
    for (const link of gitLinks) {
      chipList.appendChild(buildGitLinkRow(link));
    }
    body.appendChild(chipList);
  }

  // Commits subsection
  const commitsHead = document.createElement('h4');
  commitsHead.className = 'issues-detail__git-subhead';
  commitsHead.textContent = 'Commits';
  const commitsHost = document.createElement('div');
  commitsHost.className = 'issues-detail__git-commits';
  const commitsLoading = document.createElement('p');
  commitsLoading.className = 'issues-detail__empty';
  commitsLoading.textContent = 'Looking for commits mentioning this issue…';
  commitsHost.appendChild(commitsLoading);
  body.append(commitsHead, commitsHost);

  // Manual link rows
  const linkRow = document.createElement('div');
  linkRow.className = 'issues-detail__add-code issues-detail__git-link-row';

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

  linkRow.append(shaInput, shaBtn, urlInput, urlBtn);
  body.appendChild(linkRow);

  // Async: gh availability + commit grep
  void (async () => {
    const hasGh = await detectGhAvailable();
    if (selectedIssueId !== issue.id) return;
    if (hasGh) {
      prBtn.hidden = false;
    } else {
      prBtn.hidden = true;
      prBtn.title = 'Install and authenticate GitHub CLI (gh) to create PRs';
    }

    const listed = await listIssueCommits(issue);
    if (selectedIssueId !== issue.id) return;
    commitsHost.innerHTML = '';
    if (!listed.ok) {
      const err = document.createElement('p');
      err.className = 'issues-detail__empty';
      err.textContent = listed.error || 'Could not load commits.';
      commitsHost.appendChild(err);
      return;
    }
    if (listed.commits.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'issues-detail__empty';
      empty.textContent = `No commits with ${issue.id ? `[${issue.id}]` : 'this id'} yet.`;
      commitsHost.appendChild(empty);
      return;
    }
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

type GitUiAction = 'branch' | 'pr' | 'link-commit' | 'link-url';

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
  if (activity) {
    const chip = document.createElement('span');
    chip.className = 'issues-detail__activity-chip';
    chip.textContent = activity;
    row.appendChild(chip);
  }

  if (canExpandIssueWithAgent(issue)) {
    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'issues-btn issues-btn--primary';
    expandBtn.disabled = expandingIds.has(issue.id);
    expandBtn.textContent = expandingIds.has(issue.id) ? 'Expanding…' : 'Expand with agent';
    expandBtn.title = 'Flesh out this triage note with the issue-writer agent';
    expandBtn.addEventListener('click', () => {
      void startExpand(issue.id);
    });
    row.appendChild(expandBtn);
  }

  // Investigate — aimed at bugs; still available for other open types.
  {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'issues-btn';
    const allow = workflowOk && canInvestigateIssue(issue) && !busy;
    btn.disabled = !allow;
    btn.textContent = 'Investigate';
    btn.title =
      issue.type === 'bug'
        ? 'Spawn a debugger sub-agent and link the investigation chat'
        : 'Spawn a debugger sub-agent (best for bugs)';
    if (!workflowOk) btn.title = 'Issue is closed';
    btn.addEventListener('click', () => {
      void runWorkflowAction(issue.id, 'investigate');
    });
    row.appendChild(btn);
  }

  // Plan (interactive Code Plan mode)
  {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'issues-btn';
    btn.disabled = !workflowOk || busy;
    btn.textContent = 'Plan';
    btn.title = 'Open a Plan-mode chat seeded with this issue';
    if (!workflowOk) btn.title = 'Issue is closed';
    btn.addEventListener('click', () => {
      void runWorkflowAction(issue.id, 'plan');
    });
    row.appendChild(btn);
  }

  // Plan in background (bug-planner sub-agent)
  {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'issues-btn';
    btn.disabled = !workflowOk || busy;
    btn.textContent = 'Plan in background';
    btn.title = 'Write documentation/plans/issues/<id>.md via a planner sub-agent';
    if (!workflowOk) btn.title = 'Issue is closed';
    btn.addEventListener('click', () => {
      void runWorkflowAction(issue.id, 'plan-bg');
    });
    row.appendChild(btn);
  }

  // Debug chat
  {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'issues-btn';
    btn.disabled = !workflowOk || busy;
    btn.textContent = 'Debug chat';
    btn.title = 'Open a Debug-mode chat with full issue context';
    if (!workflowOk) btn.title = 'Issue is closed';
    btn.addEventListener('click', () => {
      void runWorkflowAction(issue.id, 'debug');
    });
    row.appendChild(btn);
  }

  // Send to board
  {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'issues-btn';
    const hasPlan = canSendIssueToBoard(issue);
    btn.disabled = !workflowOk || busy || !hasPlan;
    btn.textContent = 'Send to board';
    btn.title = hasPlan
      ? 'Launch an Orchestrate board from the issue plan'
      : 'Save a plan first (Plan or Plan in background)';
    if (!workflowOk) btn.title = 'Issue is closed';
    btn.addEventListener('click', () => {
      void runWorkflowAction(issue.id, 'board');
    });
    row.appendChild(btn);
  }

  return row;
}

type WorkflowAction = 'investigate' | 'plan' | 'plan-bg' | 'debug' | 'board';

async function runWorkflowAction(issueId: string, action: WorkflowAction): Promise<void> {
  if (workflowBusyIds.has(issueId)) return;
  workflowBusyIds.add(issueId);
  refreshIssueDetailIfOpen();
  try {
    if (action === 'investigate') {
      const result = await runIssueInvestigate(issueId);
      if (!result.ok) showIssuesToast(result.error || 'Investigate failed', 'error');
      else showIssuesToast('Investigation started', 'success');
      return;
    }
    if (action === 'plan') {
      const result = await runIssuePlanChat(issueId);
      if (!result.ok) showIssuesToast(result.error || 'Plan launch failed', 'error');
      else showIssuesToast(result.planPath ? `Plan chat · ${result.planPath}` : 'Plan chat opened', 'success');
      return;
    }
    if (action === 'plan-bg') {
      const result = await runIssuePlanBackground(issueId);
      if (!result.ok) showIssuesToast(result.error || 'Background plan failed', 'error');
      else showIssuesToast(result.planPath ? `Plan: ${result.planPath}` : 'Plan ready', 'success');
      return;
    }
    if (action === 'debug') {
      const result = await runIssueDebugChat(issueId);
      if (!result.ok) showIssuesToast(result.error || 'Debug chat failed', 'error');
      else showIssuesToast('Debug chat opened', 'success');
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
