/**
 * Source Control Center — Pull requests.
 *
 * List on the left, detail on the right. Everything runs through the user's own
 * `gh` auth, so the first thing this view does is establish whether it can work
 * at all and say so plainly when it cannot.
 */

import { appConfirm } from './app-dialog';
import {
  forgeRefresh,
  prCheckout,
  prClose,
  prCreate,
  prList,
  prMerge,
  prReady,
  prView,
  type ForgeStatus,
  type PullRequestDetail,
  type PullRequestSummary,
} from '../state/forge-api';
import { gitBranches } from '../state/git-api';
import { resolveTrunkBranchName } from '../lib/git-trunk-branch';
import { showToast } from './toast';
import {
  button,
  chip,
  diffStat,
  el,
  emptyState,
  errorStrip,
  listNavigator,
  pathLabel,
  relativeTime,
  skeletonRows,
  stateDot,
  unavailableState,
  type SccContext,
  type SccView,
} from './scc-shared';

type PrFilter = 'open' | 'all';

const REVIEW_LABEL: Record<string, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  review_required: 'Review required',
};

export function createPullsView(
  ctx: SccContext,
  options: { getForgeStatus: () => ForgeStatus | null },
): SccView {
  const root = el('div', 'scc-split');

  const listCol = el('div', 'scc-split__list');
  const toolbar = el('div', 'scc-list-view__toolbar');
  const listBody = el('div', 'scc-split__list-body');
  listCol.append(toolbar, listBody);

  const detailCol = el('div', 'scc-split__detail');
  root.append(listCol, detailCol);

  let destroyed = false;
  let filter: PrFilter = 'open';
  let selectedNumber: number | null = null;
  let cache: PullRequestSummary[] = [];

  const filterToggle = button({
    label: 'Open only',
    title: 'Toggle between open and all pull requests',
    variant: 'ghost',
    onClick: () => {
      filter = filter === 'open' ? 'all' : 'open';
      filterToggle.querySelector('.scc-btn__label')!.textContent =
        filter === 'open' ? 'Open only' : 'All states';
      void refresh();
    },
  });

  const createBtn = button({
    label: 'New pull request',
    icon: 'plus',
    variant: 'primary',
    onClick: () => void openCreateForm(),
  });

  toolbar.append(filterToggle, createBtn);

  // ── Load ───────────────────────────────────────────────────────────────────

  async function refresh(): Promise<void> {
    if (destroyed) return;

    const status = options.getForgeStatus();
    if (status && !status.supported) {
      renderUnavailable(status);
      ctx.setBadge('pulls', null);
      return;
    }

    if (listBody.childElementCount === 0) listBody.appendChild(skeletonRows(6));

    const result = await prList({ cwd: ctx.getCwd(), state: filter });
    if (destroyed) return;

    if (!result.ok) {
      listBody.replaceChildren(
        errorStrip(result.error ?? 'Could not list pull requests', () => void refresh()),
      );
      ctx.setBadge('pulls', null);
      return;
    }

    cache = result.prs ?? [];
    const openCount = cache.filter((pr) => pr.state === 'open').length;
    ctx.setBadge('pulls', openCount > 0 ? { kind: 'count', value: openCount } : null);

    renderList();

    if (selectedNumber && cache.some((pr) => pr.number === selectedNumber)) {
      await renderDetail(selectedNumber);
    } else if (!selectedNumber) {
      renderDetailPlaceholder();
    }
  }

  function renderUnavailable(status: ForgeStatus): void {
    toolbar.hidden = true;
    detailCol.hidden = true;
    root.classList.add('scc-split--single');

    const hint = !status.cliInstalled
      ? 'winget install GitHub.cli'
      : !status.authenticated
        ? 'gh auth login'
        : undefined;

    listBody.replaceChildren(
      unavailableState({
        title: status.cliInstalled ? 'Pull requests unavailable' : 'GitHub CLI not found',
        body: status.reason,
        hint,
        action: hint
          ? button({
              label: 'Check again',
              variant: 'primary',
              onClick: () => void recheck(),
            })
          : undefined,
      }),
    );
  }

  async function recheck(): Promise<void> {
    await forgeRefresh(ctx.getCwd());
    toolbar.hidden = false;
    detailCol.hidden = false;
    root.classList.remove('scc-split--single');
    await ctx.refreshAll();
  }

  function renderList(): void {
    if (cache.length === 0) {
      listBody.replaceChildren(
        emptyState({
          icon: 'gitMerge',
          title: filter === 'open' ? 'No open pull requests' : 'No pull requests',
          body: 'Push a branch and open one to get review and CI on it.',
          action: button({
            label: 'New pull request',
            variant: 'primary',
            onClick: () => void openCreateForm(),
          }),
        }),
      );
      return;
    }

    const frag = document.createDocumentFragment();
    for (const pr of cache) frag.appendChild(buildRow(pr));
    listBody.replaceChildren(frag);
  }

  function buildRow(pr: PullRequestSummary): HTMLElement {
    const row = el('div', 'scc-prrow');
    row.tabIndex = 0;
    row.dataset.number = String(pr.number);
    row.setAttribute('role', 'button');
    if (pr.number === selectedNumber) row.classList.add('is-selected');

    const top = el('div', 'scc-prrow__top');
    top.append(
      stateDot(pr.checks, `Checks: ${pr.checks}`),
      el('span', 'scc-prrow__number', `#${pr.number}`),
      el('span', 'scc-prrow__title', pr.title),
    );
    if (pr.draft) top.appendChild(chip('draft', 'draft'));
    if (pr.state !== 'open') top.appendChild(chip(pr.state, pr.state === 'merged' ? 'merged' : 'closed'));

    const meta = el('div', 'scc-prrow__meta');
    meta.append(
      el('span', 'scc-prrow__branch', `${pr.headRef} → ${pr.baseRef}`),
      diffStat(pr.additions, pr.deletions),
    );
    if (pr.author) meta.appendChild(el('span', undefined, pr.author));
    const age = relativeTime(pr.updatedAt);
    if (age) meta.appendChild(el('span', undefined, age));
    if (REVIEW_LABEL[pr.reviewDecision]) {
      meta.appendChild(
        chip(
          REVIEW_LABEL[pr.reviewDecision]!,
          pr.reviewDecision === 'approved' ? 'approved' : 'attention',
        ),
      );
    }

    row.append(top, meta);
    row.addEventListener('click', () => void select(pr.number));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void select(pr.number);
      }
    });
    return row;
  }

  async function select(number: number): Promise<void> {
    selectedNumber = number;
    for (const row of listBody.querySelectorAll('.scc-prrow')) {
      row.classList.toggle('is-selected', (row as HTMLElement).dataset.number === String(number));
    }
    await renderDetail(number);
  }

  function renderDetailPlaceholder(): void {
    detailCol.replaceChildren(
      emptyState({
        icon: 'gitMerge',
        title: 'Select a pull request',
        body: 'Its description, checks, commits, and files show here.',
      }),
    );
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async function renderDetail(number: number): Promise<void> {
    if (!detailCol.querySelector('.scc-prdetail')) detailCol.replaceChildren(skeletonRows(8));

    const result = await prView({ cwd: ctx.getCwd(), number });
    if (destroyed || selectedNumber !== number) return;

    if (!result.ok || !result.pr) {
      detailCol.replaceChildren(
        errorStrip(result.error ?? 'Could not load the pull request', () => void renderDetail(number)),
      );
      return;
    }

    detailCol.replaceChildren(buildDetail(result.pr));
  }

  function buildDetail(pr: PullRequestDetail): HTMLElement {
    const wrap = el('div', 'scc-prdetail');

    const head = el('header', 'scc-prdetail__head');
    const titleRow = el('div', 'scc-prdetail__title-row');
    titleRow.append(
      el('span', 'scc-prdetail__number', `#${pr.number}`),
      el('h2', 'scc-prdetail__title', pr.title),
    );
    head.appendChild(titleRow);

    const facts = el('div', 'scc-prdetail__facts');
    facts.append(
      chip(pr.state, pr.state === 'merged' ? 'merged' : pr.state === 'open' ? 'open' : 'closed'),
    );
    if (pr.draft) facts.appendChild(chip('draft', 'draft'));
    facts.append(
      el('span', 'scc-prdetail__branches', `${pr.headRef} → ${pr.baseRef}`),
      diffStat(pr.additions, pr.deletions),
    );
    if (pr.author) facts.appendChild(el('span', undefined, `by ${pr.author}`));
    const age = relativeTime(pr.updatedAt);
    if (age) facts.appendChild(el('span', undefined, `updated ${age} ago`));
    head.appendChild(facts);
    wrap.appendChild(head);

    wrap.appendChild(buildActions(pr));

    if (pr.statusChecks.length) {
      wrap.appendChild(sectionTitle('Checks', pr.statusChecks.length));
      const checks = el('div', 'scc-prdetail__checks');
      for (const check of pr.statusChecks) {
        const state =
          check.status && check.status !== 'completed'
            ? 'pending'
            : ['success', 'neutral'].includes(check.conclusion)
              ? 'success'
              : check.conclusion === 'skipped'
                ? 'skipped'
                : 'failure';
        const row = el('div', 'scc-checkrow');
        row.append(
          stateDot(state, `${check.name}: ${check.conclusion || check.status || 'pending'}`),
          el('span', 'scc-checkrow__name', check.name),
          el('span', 'scc-checkrow__state', check.conclusion || check.status || 'pending'),
        );
        checks.appendChild(row);
      }
      wrap.appendChild(checks);
    }

    if (pr.reviews.length) {
      wrap.appendChild(sectionTitle('Reviews', pr.reviews.length));
      const reviews = el('div', 'scc-prdetail__reviews');
      for (const review of pr.reviews) {
        const row = el('div', 'scc-reviewrow');
        row.append(
          el('span', 'scc-reviewrow__author', review.author),
          chip(
            review.state.replace(/_/g, ' '),
            review.state === 'approved'
              ? 'approved'
              : review.state === 'changes_requested'
                ? 'attention'
                : undefined,
          ),
        );
        if (review.body) row.appendChild(el('p', 'scc-reviewrow__body', review.body));
        reviews.appendChild(row);
      }
      wrap.appendChild(reviews);
    }

    if (pr.body.trim()) {
      wrap.appendChild(sectionTitle('Description'));
      wrap.appendChild(el('pre', 'scc-prdetail__body', pr.body.trim()));
    }

    if (pr.files.length) {
      wrap.appendChild(sectionTitle('Files', pr.files.length));
      const files = el('div', 'scc-prdetail__files');
      for (const file of pr.files) {
        const row = el('div', 'scc-prfile');
        row.append(pathLabel(file.path), diffStat(file.additions, file.deletions));
        files.appendChild(row);
      }
      wrap.appendChild(files);
    }

    if (pr.commits.length) {
      wrap.appendChild(sectionTitle('Commits', pr.commits.length));
      const commits = el('div', 'scc-prdetail__commits');
      for (const commit of pr.commits) {
        const row = el('div', 'scc-prcommit');
        row.append(chip(commit.sha, 'sha'), el('span', 'scc-prcommit__subject', commit.subject));
        if (commit.author) row.appendChild(el('span', 'scc-prcommit__author', commit.author));
        commits.appendChild(row);
      }
      wrap.appendChild(commits);
    }

    return wrap;
  }

  function buildActions(pr: PullRequestDetail): HTMLElement {
    const bar = el('div', 'scc-prdetail__actions');

    if (pr.state === 'open') {
      const mergeBtn = button({
        label: 'Squash and merge',
        icon: 'gitMerge',
        variant: 'primary',
        onClick: () => void merge(pr, 'squash'),
      });
      if (pr.checks === 'failure') {
        mergeBtn.title = 'Checks are failing on this pull request';
        mergeBtn.classList.add('scc-btn--caution');
      }
      bar.appendChild(mergeBtn);

      bar.appendChild(
        button({ label: 'Merge commit', variant: 'ghost', onClick: () => void merge(pr, 'merge') }),
      );
      bar.appendChild(
        button({ label: 'Rebase', variant: 'ghost', onClick: () => void merge(pr, 'rebase') }),
      );
    }

    bar.appendChild(
      button({
        label: 'Check out',
        icon: 'gitBranch',
        onClick: () => void checkout(pr.number),
      }),
    );

    if (pr.draft) {
      bar.appendChild(
        button({
          label: 'Ready for review',
          variant: 'ghost',
          onClick: async () => {
            const result = await prReady({ cwd: ctx.getCwd(), number: pr.number });
            if (!result.ok) {
              showToast(result.error ?? 'Could not update the pull request', 'error');
              return;
            }
            showToast(`#${pr.number} is ready for review`, 'success');
            await refresh();
          },
        }),
      );
    }

    if (pr.url) {
      const link = el('a', 'scc-btn scc-btn--ghost', 'Open on GitHub');
      link.href = pr.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      bar.appendChild(link);
    }

    if (pr.state === 'open') {
      bar.appendChild(
        button({
          label: 'Close',
          variant: 'ghost',
          className: 'scc-btn--danger-hover',
          onClick: () => void close(pr),
        }),
      );
    }

    return bar;
  }

  async function merge(
    pr: PullRequestDetail,
    method: 'merge' | 'squash' | 'rebase',
  ): Promise<void> {
    const warning =
      pr.checks === 'failure'
        ? ' Checks are failing.'
        : pr.checks === 'pending'
          ? ' Checks are still running.'
          : '';

    const confirmed = await appConfirm(
      `${method === 'squash' ? 'Squash and merge' : method === 'rebase' ? 'Rebase and merge' : 'Merge'} #${pr.number} into ${pr.baseRef}?${warning}`,
      {
        title: 'Merge pull request',
        confirmLabel: 'Merge',
        danger: pr.checks === 'failure',
      },
    );
    if (!confirmed) return;

    const deleteBranch = await appConfirm(`Delete ${pr.headRef} after merging?`, {
      title: 'Delete branch',
      confirmLabel: 'Delete branch',
      cancelLabel: 'Keep branch',
    });

    const result = await prMerge({ cwd: ctx.getCwd(), number: pr.number, method, deleteBranch });
    if (!result.ok) {
      showToast(result.error ?? 'Could not merge the pull request', 'error');
      return;
    }
    showToast(`Merged #${pr.number}`, 'success');
    selectedNumber = null;
    await ctx.refreshAll();
  }

  async function checkout(number: number): Promise<void> {
    const result = await prCheckout({ cwd: ctx.getCwd(), number });
    if (!result.ok) {
      showToast(result.error ?? 'Could not check out the pull request', 'error');
      return;
    }
    showToast(`Checked out #${number}`, 'success');
    await ctx.refreshAll();
  }

  async function close(pr: PullRequestDetail): Promise<void> {
    const confirmed = await appConfirm(`Close #${pr.number} without merging?`, {
      title: 'Close pull request',
      confirmLabel: 'Close',
      danger: true,
    });
    if (!confirmed) return;

    const result = await prClose({ cwd: ctx.getCwd(), number: pr.number });
    if (!result.ok) {
      showToast(result.error ?? 'Could not close the pull request', 'error');
      return;
    }
    showToast(`Closed #${pr.number}`, 'success');
    selectedNumber = null;
    await refresh();
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async function openCreateForm(): Promise<void> {
    const status = options.getForgeStatus();
    if (status && !status.supported) {
      showToast(status.reason, 'error');
      return;
    }

    const branchResult = await gitBranches(ctx.getCwd());
    const trunk = branchResult.ok
      ? resolveTrunkBranchName(
          branchResult.local ?? [],
          branchResult.remote ?? [],
          branchResult.lockedLocal ?? [],
        )
      : 'main';
    const head = ctx.getBranch();

    selectedNumber = null;
    for (const row of listBody.querySelectorAll('.scc-prrow')) row.classList.remove('is-selected');

    const form = el('form', 'scc-prform');

    const heading = el('div', 'scc-prform__head');
    heading.append(
      el('h2', 'scc-prform__title', 'New pull request'),
      el('p', 'scc-prform__branches', `${head || 'current branch'} → ${trunk}`),
    );

    const titleField = el('input', 'scc-input');
    titleField.type = 'text';
    titleField.placeholder = 'Title';
    titleField.required = true;
    titleField.setAttribute('aria-label', 'Pull request title');

    const bodyField = el('textarea', 'scc-textarea');
    bodyField.rows = 8;
    bodyField.placeholder = 'What changed, and why';
    bodyField.setAttribute('aria-label', 'Pull request description');

    const baseField = el('input', 'scc-input scc-input--compact');
    baseField.type = 'text';
    baseField.value = trunk;
    baseField.setAttribute('aria-label', 'Base branch');

    const draftLabel = el('label', 'scc-checkbox');
    const draftInput = el('input');
    draftInput.type = 'checkbox';
    draftLabel.append(draftInput, el('span', undefined, 'Open as draft'));

    const actions = el('div', 'scc-prform__actions');
    const submit = button({ label: 'Create pull request', variant: 'primary' });
    submit.type = 'submit';
    actions.append(
      button({ label: 'Cancel', variant: 'ghost', onClick: () => renderDetailPlaceholder() }),
      submit,
    );

    const baseRow = el('div', 'scc-prform__row');
    baseRow.append(el('span', 'scc-prform__label', 'Base'), baseField, draftLabel);

    form.append(heading, titleField, baseRow, bodyField, actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = titleField.value.trim();
      if (!title) {
        titleField.focus();
        return;
      }

      submit.disabled = true;
      submit.querySelector('.scc-btn__label')!.textContent = 'Creating…';

      const result = await prCreate({
        cwd: ctx.getCwd(),
        title,
        body: bodyField.value,
        base: baseField.value.trim() || undefined,
        draft: draftInput.checked,
      });

      submit.disabled = false;
      submit.querySelector('.scc-btn__label')!.textContent = 'Create pull request';

      if (!result.ok) {
        showToast(result.error ?? 'Could not create the pull request', 'error');
        return;
      }
      showToast('Pull request opened', 'success');
      await refresh();
    });

    detailCol.replaceChildren(form);
    titleField.focus();
  }

  const navigate = listNavigator({
    getRows: () => [...listBody.querySelectorAll<HTMLElement>('.scc-prrow')],
  });

  void refresh();

  return {
    root,
    refresh,
    onKey: (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return false;
      return navigate(event);
    },
    destroy: () => {
      destroyed = true;
      root.remove();
    },
  };
}

function sectionTitle(title: string, count?: number): HTMLElement {
  const head = el('div', 'scc-prdetail__section');
  head.appendChild(el('span', 'scc-prdetail__section-title', title));
  if (count !== undefined) {
    head.appendChild(el('span', 'scc-prdetail__section-count', String(count)));
  }
  return head;
}
