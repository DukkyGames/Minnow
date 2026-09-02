import { gh, parseJson, processError, requireForge } from './forge-ops.js';

const ISSUE_FIELDS = [
  'number',
  'title',
  'body',
  'state',
  'url',
  'labels',
  'assignees',
  'createdAt',
  'updatedAt',
].join(',');

const MAX_ISSUE_BODY_CHARS = 16_000;

function forgeCatch(err, fallback) {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message || fallback };
}

/**
 * @param {any} raw
 */
export function normalizeForgeIssue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const number = Number(raw.number);
  if (!Number.isFinite(number) || number <= 0) return null;
  return {
    number,
    title: String(raw.title ?? ''),
    body: truncateIssueBody(String(raw.body ?? '')),
    state: String(raw.state ?? '').toLowerCase(),
    url: String(raw.url ?? ''),
    labels: Array.isArray(raw.labels)
      ? raw.labels.map((l) => String(l?.name ?? l ?? '')).filter(Boolean)
      : [],
    assignees: Array.isArray(raw.assignees)
      ? raw.assignees.map((a) => String(a?.login ?? a ?? '')).filter(Boolean)
      : [],
    createdAt: raw.createdAt ? Date.parse(raw.createdAt) || undefined : undefined,
    updatedAt: raw.updatedAt ? Date.parse(raw.updatedAt) || undefined : undefined,
  };
}

function truncateIssueBody(body) {
  if (body.length <= MAX_ISSUE_BODY_CHARS) return body;
  return `${body.slice(0, MAX_ISSUE_BODY_CHARS - 1)}…`;
}

/**
 * @param {string} stdout
 */
export function parseIssueCreateOutput(stdout) {
  const url = String(stdout ?? '')
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^https?:\/\//.test(line));
  const match = url ? /\/issues\/(\d+)/.exec(url) : null;
  return { url: url ?? '', number: match ? Number(match[1]) : undefined };
}

export async function issueList({ cwd, state = 'open', limit = 100, labels } = {}) {
  try {
    const gate = await requireForge(cwd);
    if (!gate.ok) return gate;

    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const args = [
      'issue',
      'list',
      '--state',
      String(state),
      '--limit',
      String(safeLimit),
      '--json',
      ISSUE_FIELDS,
    ];
    if (typeof labels === 'string' && labels.trim()) {
      args.push('--label', labels.trim());
    }

    const result = await gh(args, gate.cwd);
    if (result.code !== 0) {
      return { ok: false, error: processError(result, 'Could not list issues') };
    }
    if (result.accumulationTruncated) {
      return {
        ok: false,
        error:
          'GitHub returned more issue data than Minnow can import at once. Try again with fewer open issues, or import later.',
      };
    }
    const raw = parseJson(result.stdout, null);
    if (!Array.isArray(raw)) {
      return { ok: false, error: 'Could not parse the GitHub issue list' };
    }
    const issues = raw.map(normalizeForgeIssue).filter(Boolean);
    return { ok: true, issues };
  } catch (err) {
    return forgeCatch(err, 'Could not list issues');
  }
}

export async function issueView({ cwd, number } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const num = Number(number);
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: 'An issue number is required' };
  }

  const result = await gh(['issue', 'view', String(num), '--json', ISSUE_FIELDS], gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, `Could not read issue #${num}`) };
  }
  const issue = normalizeForgeIssue(parseJson(result.stdout, null));
  if (!issue) return { ok: false, error: `Issue #${num} could not be parsed` };
  return { ok: true, issue };
}

export async function issueCreate({ cwd, title, body, labels } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const cleanTitle = String(title ?? '').trim();
  if (!cleanTitle) return { ok: false, error: 'A title is required' };

  const base = ['issue', 'create', '--title', cleanTitle, '--body', String(body ?? '')];
  const args = [...base];
  for (const label of Array.isArray(labels) ? labels : []) {
    const name = String(label ?? '').trim();
    if (name) args.push('--label', name);
  }

  const result = await gh(args, gate.cwd);
  if (result.code === 0) {
    return { ok: true, ...parseIssueCreateOutput(result.stdout) };
  }

  const usedLabels = args.length > base.length;
  if (usedLabels && /label/i.test(String(result.stderr ?? ''))) {
    const retry = await gh(base, gate.cwd);
    if (retry.code === 0) {
      return { ok: true, ...parseIssueCreateOutput(retry.stdout), droppedLabels: true };
    }
  }
  return { ok: false, error: processError(result, 'Could not create the issue') };
}

export async function issueEdit({ cwd, number, title, body, addLabels, removeLabels } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const num = Number(number);
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: 'An issue number is required' };
  }

  const args = ['issue', 'edit', String(num)];
  if (typeof title === 'string' && title.trim()) args.push('--title', title.trim());
  if (typeof body === 'string') args.push('--body', body);
  for (const label of Array.isArray(addLabels) ? addLabels : []) {
    const name = String(label ?? '').trim();
    if (name) args.push('--add-label', name);
  }
  for (const label of Array.isArray(removeLabels) ? removeLabels : []) {
    const name = String(label ?? '').trim();
    if (name) args.push('--remove-label', name);
  }
  if (args.length === 3) return { ok: false, error: 'Nothing to update' };

  const result = await gh(args, gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, `Could not update issue #${num}`) };
  }
  return { ok: true, number: num };
}

export async function issueState({ cwd, number, state = 'closed', reason } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const num = Number(number);
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: 'An issue number is required' };
  }
  const verb = String(state).toLowerCase() === 'open' ? 'reopen' : 'close';
  const args = ['issue', verb, String(num)];
  if (verb === 'close' && typeof reason === 'string' && reason.trim()) {
    args.push('--reason', reason.trim());
  }

  const result = await gh(args, gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, `Could not ${verb} issue #${num}`) };
  }
  return { ok: true, number: num, state: verb === 'close' ? 'closed' : 'open' };
}

export async function issueComment({ cwd, number, body } = {}) {
  const gate = await requireForge(cwd);
  if (!gate.ok) return gate;

  const num = Number(number);
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: 'An issue number is required' };
  }
  const text = String(body ?? '').trim();
  if (!text) return { ok: false, error: 'A comment body is required' };

  const result = await gh(['issue', 'comment', String(num), '--body', text], gate.cwd);
  if (result.code !== 0) {
    return { ok: false, error: processError(result, `Could not comment on issue #${num}`) };
  }
  return { ok: true, number: num };
}
