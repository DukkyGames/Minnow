/**
 * Forge operations for /api/git — pull requests and CI, via the `gh` CLI.
 *
 * Local-first by design: no tokens are stored in ~/.minnow. Everything runs
 * through the user's own `gh` auth. Non-GitHub remotes are detected and
 * reported honestly rather than surfacing an empty list.
 */

import { runProcess } from '../process-runner.js';
import { isGitRepository } from '../tools/git-change-stats.js';
import { getWorkspaceRoot } from '../workspace/root.js';

const GH_TIMEOUT_MS = 45_000;
const GH_LOG_TIMEOUT_MS = 90_000;

/** forgeStatus is hit on every poll; probing `gh auth` each time is wasteful. */
const STATUS_TTL_MS = 60_000;
/** @type {Map<string, { at: number, value: object }>} */
const statusCache = new Map();

/** Resolve working directory for forge commands. */
function resolveCwd(cwd) {
  return cwd && String(cwd).trim() ? String(cwd).trim() : getWorkspaceRoot();
}

/** Run `gh` with paging and colour disabled. Exported for forge-issue-ops.js.
 *  Never rejects — timeout and missing-binary become a non-zero result so a
 *  forge call cannot take down `/api/git` (MIN-660). */
export async function gh(args, cwd, timeout = GH_TIMEOUT_MS) {
  try {
    return await runProcess('gh', args, {
      cwd,
      timeout,
      // gh paginates and colorizes when it thinks it owns a terminal.
      env: { GH_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1', CLICOLOR: '0' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      code: 1,
      stdout: '',
      stderr: message,
      timedOut: /timed out/i.test(message),
    };
  }
}

/** Combined stdout/stderr, trimmed, for error surfaces. */
export function processError(result, fallback) {
  const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
  if (!text) return fallback;
  // gh prefixes hard failures with a cross; strip it so the UI can style its own.
  return text.replace(/^[Xx✗]\s+/, '').split('\n').slice(0, 6).join('\n');
}

/**
 * Classify a git remote URL by hosting provider.
 * Handles ssh (`git@host:owner/repo`), scp-ish, and https forms.
 * @param {string} url
 * @returns {{ host: string, slug: string, hostname: string }}
 */
export function parseRemoteHost(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return { host: 'none', slug: '', hostname: '' };

  let hostname = '';
  let pathPart = '';

  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(raw);
  if (scp && !raw.includes('://')) {
    hostname = scp[1] ?? '';
    pathPart = scp[2] ?? '';
  } else {
    try {
      const parsed = new URL(raw);
      hostname = parsed.hostname;
      pathPart = parsed.pathname;
    } catch {
      return { host: 'other', slug: '', hostname: '' };
    }
  }

  hostname = hostname.toLowerCase();
  const slug = pathPart
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');

  let host = 'other';
  if (hostname === 'github.com' || hostname.endsWith('.github.com')) host = 'github';
  else if (hostname === 'gitlab.com' || hostname.startsWith('gitlab.')) host = 'gitlab';
  else if (hostname === 'bitbucket.org') host = 'bitbucket';
  else if (hostname.includes('github')) host = 'github-enterprise';

  return { host, slug, hostname };
}

/** Read `origin` (or the first remote) URL without going through git-ops. */
async function readRemoteUrl(cwd) {
  const origin = await runProcess('git', ['remote', 'get-url', 'origin'], {
    cwd,
    timeout: 15_000,
  });
  if (origin.code === 0 && origin.stdout.trim()) return origin.stdout.trim();

  const all = await runProcess('git', ['remote'], { cwd, timeout: 15_000 });
  const first = all.stdout.split('\n').map((l) => l.trim()).filter(Boolean)[0];
  if (!first) return '';

  const named = await runProcess('git', ['remote', 'get-url', first], {
    cwd,
    timeout: 15_000,
  });
  return named.code === 0 ? named.stdout.trim() : '';
}

/**
 * Probe what the forge layer can actually do here.
 * Never throws — every failure mode becomes a `reason` the UI can render.
 */
export async function forgeStatus({ cwd, refresh } = {}) {
  const root = resolveCwd(cwd);

  try {
    if (!refresh) {
      const hit = statusCache.get(root);
      if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value;
    }

    const value = await probeForgeStatus(root);
    statusCache.set(root, { at: Date.now(), value });
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      host: 'none',
      hostname: '',
      remoteUrl: '',
      repo: '',
      supported: false,
      cliInstalled: false,
      cliVersion: '',
      authenticated: false,
      reason: message || 'Pull requests are unavailable here',
    };
  }
}

async function probeForgeStatus(root) {
  const base = {
    ok: true,
    host: 'none',
    hostname: '',
    remoteUrl: '',
    repo: '',
    supported: false,
    cliInstalled: false,
    cliVersion: '',
    authenticated: false,
    reason: '',
  };

  if (!(await isGitRepository(root))) {
    return { ...base, ok: false, reason: 'Not a git repository' };
  }

  const remoteUrl = await readRemoteUrl(root);
  if (!remoteUrl) {
    return { ...base, reason: 'This repository has no remote. Add one to work with pull requests.' };
  }

  const { host, slug, hostname } = parseRemoteHost(remoteUrl);
  const withRemote = { ...base, host, hostname, remoteUrl, repo: slug };

  if (host !== 'github' && host !== 'github-enterprise') {
    const label =
      host === 'gitlab' ? 'GitLab' : host === 'bitbucket' ? 'Bitbucket' : hostname || 'this remote';
    return {
      ...withRemote,
      reason: `Pull requests and CI are read through the GitHub CLI. ${label} is not supported yet.`,
    };
  }

  let version = '';
  try {
    const probe = await gh(['--version'], root, 15_000);
    if (probe.code !== 0) {
      return {
        ...withRemote,
        reason: 'The GitHub CLI (gh) is not installed. Install it to manage pull requests and CI.',
      };
    }
    version = (probe.stdout.split('\n')[0] ?? '').replace(/^gh version\s*/i, '').trim();
  } catch {
    return {
      ...withRemote,
      reason: 'The GitHub CLI (gh) is not installed. Install it to manage pull requests and CI.',
    };
  }

  const auth = await gh(['auth', 'status'], root, 20_000);
  if (auth.code !== 0) {
    return {
      ...withRemote,
      cliInstalled: true,
      cliVersion: version,
      reason: 'The GitHub CLI is not signed in. Run `gh auth login` to manage pull requests and CI.',
    };
  }

  return {
    ...withRemote,
    supported: true,
    cliInstalled: true,
    cliVersion: version,
    authenticated: true,
  };
}

/** Gate every forge op behind a usable gh + supported remote. */
/** Gate every forge call on a GitHub remote plus working `gh` auth. */
export async function requireForge(cwd) {
  const root = resolveCwd(cwd);
  const status = await forgeStatus({ cwd: root });
  if (!status.supported) {
    return { ok: false, error: status.reason || 'Pull requests are unavailable here', status };
  }
  return { ok: true, cwd: root, status };
}

/** Parse gh --json output; gh emits `[]`/`{}` or nothing. */
export function parseJson(stdout, fallback) {
  const text = String(stdout ?? '').trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const PR_LIST_FIELDS = [
  'number',
  'title',
  'state',
  'isDraft',
  'author',
  'headRefName',
  'baseRefName',
  'createdAt',
  'updatedAt',
  'additions',
  'deletions',
  'changedFiles',
  'url',
  'reviewDecision',
  'mergeable',
  'labels',
  'statusCheckRollup',
].join(',');

/** Collapse a statusCheckRollup array into one word the UI can colour. */
export function rollupConclusion(rollup) {
  const list = Array.isArray(rollup) ? rollup : [];
  if (list.length === 0) return 'none';

  let pending = false;
  let failing = false;

  for (const check of list) {
    // CheckRun uses status/conclusion; StatusContext uses state.
    const status = String(check?.status ?? '').toUpperCase();
    const conclusion = String(check?.conclusion ?? check?.state ?? '').toUpperCase();

    if (status && status !== 'COMPLETED') {
      pending = true;
      continue;
    }
    if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ERROR', 'ACTION_REQUIRED'].includes(conclusion)) {
      failing = true;
    } else if (['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED'].includes(conclusion)) {
      pending = true;
    }
  }

  if (failing) return 'failure';
  if (pending) return 'pending';
  return 'success';
}

/** Flatten one gh PR record into the shape the client renders. */
function normalizePr(pr) {
  const rollup = Array.isArray(pr?.statusCheckRollup) ? pr.statusCheckRollup : [];
  return {
    number: Number(pr?.number ?? 0),
    title: String(pr?.title ?? ''),
    state: String(pr?.state ?? '').toLowerCase(),
    draft: Boolean(pr?.isDraft),
    author: String(pr?.author?.login ?? ''),
    headRef: String(pr?.headRefName ?? ''),
    baseRef: String(pr?.baseRefName ?? ''),
    createdAt: String(pr?.createdAt ?? ''),
    updatedAt: String(pr?.updatedAt ?? ''),
    additions: Number(pr?.additions ?? 0),
    deletions: Number(pr?.deletions ?? 0),
    changedFiles: Number(pr?.changedFiles ?? 0),
    url: String(pr?.url ?? ''),
    reviewDecision: String(pr?.reviewDecision ?? '').toLowerCase(),
    mergeable: String(pr?.mergeable ?? '').toLowerCase(),
    labels: (Array.isArray(pr?.labels) ? pr.labels : []).map((l) => ({
      name: String(l?.name ?? ''),
      color: String(l?.color ?? ''),
    })),
    checks: rollupConclusion(rollup),
    checkCount: rollup.length,
  };
}

/** List pull requests. `state` is one of open | closed | merged | all. */
export async function prList({ cwd, state = 'open', limit = 50 } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const result = await gh(
    ['pr', 'list', '--state', String(state), '--limit', String(safeLimit), '--json', PR_LIST_FIELDS],
    gate.cwd,
  );
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not list pull requests') };
  }

  const raw = parseJson(result.stdout, []);
  return { ok: true, prs: (Array.isArray(raw) ? raw : []).map(normalizePr) };
}

const PR_VIEW_FIELDS = [
  PR_LIST_FIELDS,
  'body',
  'commits',
  'files',
  'reviews',
  'headRepositoryOwner',
  'isCrossRepository',
  'mergeStateStatus',
].join(',');

/** Full detail for one pull request, including changed files and reviews. */
export async function prView({ cwd, number } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const num = Number(number);
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: 'A pull request number is required' };
  }

  const result = await gh(['pr', 'view', String(num), '--json', PR_VIEW_FIELDS], gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, `Could not load pull request #${num}`) };
  }

  const raw = parseJson(result.stdout, null);
  if (!raw) return { ok: false, error: `Could not read pull request #${num}` };

  return {
    ok: true,
    pr: {
      ...normalizePr(raw),
      body: String(raw?.body ?? ''),
      mergeStateStatus: String(raw?.mergeStateStatus ?? '').toLowerCase(),
      crossRepository: Boolean(raw?.isCrossRepository),
      files: (Array.isArray(raw?.files) ? raw.files : []).map((f) => ({
        path: String(f?.path ?? ''),
        additions: Number(f?.additions ?? 0),
        deletions: Number(f?.deletions ?? 0),
      })),
      commits: (Array.isArray(raw?.commits) ? raw.commits : []).map((c) => ({
        sha: String(c?.oid ?? '').slice(0, 7),
        subject: String(c?.messageHeadline ?? ''),
        author: String(c?.authors?.[0]?.login ?? c?.authors?.[0]?.name ?? ''),
      })),
      reviews: (Array.isArray(raw?.reviews) ? raw.reviews : []).map((r) => ({
        author: String(r?.author?.login ?? ''),
        state: String(r?.state ?? '').toLowerCase(),
        body: String(r?.body ?? ''),
      })),
      statusChecks: (Array.isArray(raw?.statusCheckRollup) ? raw.statusCheckRollup : []).map(
        (c) => ({
          name: String(c?.name ?? c?.context ?? ''),
          status: String(c?.status ?? '').toLowerCase(),
          conclusion: String(c?.conclusion ?? c?.state ?? '').toLowerCase(),
          url: String(c?.detailsUrl ?? c?.targetUrl ?? ''),
        }),
      ),
    },
  };
}

/** Unified diff for one pull request. */
export async function prDiff({ cwd, number } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const result = await gh(['pr', 'diff', String(Number(number))], gate.cwd, GH_LOG_TIMEOUT_MS);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not load pull request diff') };
  }
  return { ok: true, patch: result.stdout };
}

/** Open a pull request from the current branch. */
export async function prCreate({ cwd, title, body, base, draft, web } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const trimmedTitle = String(title ?? '').trim();
  if (!trimmedTitle && !web) return { ok: false, error: 'A title is required' };

  const args = ['pr', 'create'];
  if (web) {
    args.push('--web');
  } else {
    args.push('--title', trimmedTitle, '--body', String(body ?? ''));
    if (base && String(base).trim()) args.push('--base', String(base).trim());
    if (draft) args.push('--draft');
  }

  const result = await gh(args, gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not create the pull request') };
  }

  const url = (result.stdout.match(/https?:\/\/\S+/) ?? [''])[0];
  return { ok: true, url, stdout: result.stdout.trim() };
}

const MERGE_FLAG = { merge: '--merge', squash: '--squash', rebase: '--rebase' };

/** Merge a pull request. `method` is merge | squash | rebase. */
export async function prMerge({ cwd, number, method = 'squash', deleteBranch, auto } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const flag = MERGE_FLAG[String(method)];
  if (!flag) return { ok: false, error: `Unknown merge method: ${method}` };

  const args = ['pr', 'merge', String(Number(number)), flag];
  if (deleteBranch) args.push('--delete-branch');
  if (auto) args.push('--auto');

  const result = await gh(args, gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not merge the pull request') };
  }
  return { ok: true, stdout: result.stdout.trim() };
}

/** Check out a pull request branch locally. */
export async function prCheckout({ cwd, number } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const result = await gh(['pr', 'checkout', String(Number(number))], gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not check out the pull request') };
  }
  return { ok: true, stdout: result.stdout.trim() };
}

/** Take a pull request out of draft. */
export async function prReady({ cwd, number } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const result = await gh(['pr', 'ready', String(Number(number))], gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not mark the pull request ready') };
  }
  return { ok: true };
}

/** Close a pull request without merging. */
export async function prClose({ cwd, number, deleteBranch } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const args = ['pr', 'close', String(Number(number))];
  if (deleteBranch) args.push('--delete-branch');

  const result = await gh(args, gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not close the pull request') };
  }
  return { ok: true };
}

const RUN_LIST_FIELDS = [
  'databaseId',
  'displayTitle',
  'workflowName',
  'status',
  'conclusion',
  'headBranch',
  'headSha',
  'event',
  'createdAt',
  'updatedAt',
  'startedAt',
  'number',
  'url',
].join(',');

/**
 * A workflow with no `name:` key reports its file path as the name. Show the
 * basename so the list reads as workflow names rather than repeated paths.
 */
export function displayWorkflowName(workflowName) {
  const raw = String(workflowName ?? '').trim();
  if (!raw.includes('/') && !raw.includes('\\')) return raw;
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return base.replace(/\.ya?ml$/i, '');
}

function normalizeRun(run) {
  return {
    id: Number(run?.databaseId ?? 0),
    number: Number(run?.number ?? 0),
    title: String(run?.displayTitle ?? ''),
    workflow: displayWorkflowName(run?.workflowName),
    workflowPath: String(run?.workflowName ?? ''),
    status: String(run?.status ?? '').toLowerCase(),
    conclusion: String(run?.conclusion ?? '').toLowerCase(),
    branch: String(run?.headBranch ?? ''),
    sha: String(run?.headSha ?? '').slice(0, 7),
    event: String(run?.event ?? ''),
    createdAt: String(run?.createdAt ?? ''),
    updatedAt: String(run?.updatedAt ?? ''),
    startedAt: String(run?.startedAt ?? ''),
    url: String(run?.url ?? ''),
  };
}

/** List recent workflow runs, optionally scoped to one branch. */
export async function runList({ cwd, branch, limit = 25 } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const args = ['run', 'list', '--limit', String(safeLimit), '--json', RUN_LIST_FIELDS];
  if (branch && String(branch).trim()) args.push('--branch', String(branch).trim());

  const result = await gh(args, gate.cwd);
  if (result.code !== 0) {
    // A repo with Actions disabled is a normal state, not an error worth shouting about.
    const text = processError(result, 'Could not list workflow runs');
    if (/no workflow|not enabled|disabled/i.test(text)) {
      return { ok: true, runs: [], note: 'No GitHub Actions workflows in this repository.' };
    }
    return { ok: false, error: text };
  }

  const raw = parseJson(result.stdout, []);
  return { ok: true, runs: (Array.isArray(raw) ? raw : []).map(normalizeRun) };
}

/** One workflow run with its jobs and steps. */
export async function runView({ cwd, id } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const runId = Number(id);
  if (!Number.isFinite(runId) || runId <= 0) return { ok: false, error: 'A run id is required' };

  const result = await gh(
    ['run', 'view', String(runId), '--json', `${RUN_LIST_FIELDS},jobs`],
    gate.cwd,
  );
  if (result.code !== 0) {
    return { ok: false, error: processError(result, `Could not load run ${runId}`) };
  }

  const raw = parseJson(result.stdout, null);
  if (!raw) return { ok: false, error: `Could not read run ${runId}` };

  return {
    ok: true,
    run: {
      ...normalizeRun(raw),
      jobs: (Array.isArray(raw?.jobs) ? raw.jobs : []).map((job) => ({
        id: Number(job?.databaseId ?? 0),
        name: String(job?.name ?? ''),
        status: String(job?.status ?? '').toLowerCase(),
        conclusion: String(job?.conclusion ?? '').toLowerCase(),
        startedAt: String(job?.startedAt ?? ''),
        completedAt: String(job?.completedAt ?? ''),
        url: String(job?.url ?? ''),
        steps: (Array.isArray(job?.steps) ? job.steps : []).map((step) => ({
          name: String(step?.name ?? ''),
          status: String(step?.status ?? '').toLowerCase(),
          conclusion: String(step?.conclusion ?? '').toLowerCase(),
          number: Number(step?.number ?? 0),
        })),
      })),
    },
  };
}

/** Re-run a workflow run, optionally only its failed jobs. */
export async function runRerun({ cwd, id, failedOnly } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const args = ['run', 'rerun', String(Number(id))];
  if (failedOnly) args.push('--failed');

  const result = await gh(args, gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not re-run the workflow') };
  }
  return { ok: true };
}

/** Cancel an in-progress workflow run. */
export async function runCancel({ cwd, id } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const result = await gh(['run', 'cancel', String(Number(id))], gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not cancel the run') };
  }
  return { ok: true };
}

/** Tail of a run's log — failed steps only by default, since that is what gets read. */
export async function runLog({ cwd, id, jobId, failedOnly = true, maxLines = 400 } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const args = ['run', 'view', String(Number(id))];
  if (jobId) args.push('--job', String(Number(jobId)), '--log');
  else if (failedOnly) args.push('--log-failed');
  else args.push('--log');

  const result = await gh(args, gate.cwd, GH_LOG_TIMEOUT_MS);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, 'Could not read the run log') };
  }

  const lines = result.stdout.split('\n');
  const cap = Math.min(Math.max(Number(maxLines) || 400, 20), 2000);
  const truncated = lines.length > cap;

  return {
    ok: true,
    log: (truncated ? lines.slice(-cap) : lines).join('\n'),
    truncated,
    totalLines: lines.length,
  };
}

/** Drop the cached forge probe (workspace switch, `gh auth login` in the terminal). */
export function invalidateForgeStatusCache(cwd) {
  if (cwd) statusCache.delete(resolveCwd(cwd));
  else statusCache.clear();
}
