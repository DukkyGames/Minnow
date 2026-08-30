/**
 * Fetch the PR snapshot + patch, then build the reviewer task envelope.
 *
 * `buildPrReviewTask` is pure so tests can pin the budget split without hitting `gh`.
 */

import {
  prDiff,
  prView,
  type PullRequestDetail,
} from '../../state/forge-api.ts';

/** Inline the full patch when it fits; otherwise a file table plus the largest hunks. */
export const PR_REVIEW_PATCH_BUDGET = 120_000;

export interface PrReviewContext {
  pr: PullRequestDetail;
  patch: string;
  cwd: string;
}

export interface FetchPrReviewContextInput {
  cwd?: string;
  number: number;
}

export type FetchPrReviewContextResult =
  | { ok: true; ctx: PrReviewContext }
  | { ok: false; error: string };

/** One file extracted from a unified diff. */
export interface PatchFileStat {
  path: string;
  additions: number;
  deletions: number;
  body: string;
}

/** Load `prView` + `prDiff`. Forge failures surface `reason` / `error` verbatim. */
export async function fetchPrReviewContext(
  input: FetchPrReviewContextInput,
): Promise<FetchPrReviewContextResult> {
  const cwd = input.cwd?.trim() || undefined;
  const view = await prView({ cwd, number: input.number });
  if (!view.ok || !view.pr) {
    return { ok: false, error: forgeFailureReason(view) };
  }

  const diff = await prDiff({ cwd, number: input.number });
  if (!diff.ok) {
    return { ok: false, error: forgeFailureReason(diff) };
  }

  return {
    ok: true,
    ctx: {
      pr: view.pr,
      patch: diff.patch ?? '',
      cwd: cwd ?? '',
    },
  };
}

/** Prefer the user-facing forge reason over a generic HTTP error. */
function forgeFailureReason(result: {
  error?: string;
  status?: { reason?: string };
}): string {
  const fromStatus = result.status?.reason?.trim();
  if (fromStatus) return fromStatus;
  return result.error?.trim() || 'Could not load the pull request';
}

/** Build the unattended task the `pr-reviewer` sub-agent receives. */
export function buildPrReviewTask(ctx: PrReviewContext): string {
  const { pr, patch, cwd } = ctx;
  const lines: string[] = [];

  lines.push(`Review pull request #${pr.number}: ${pr.title.trim() || '(no title)'}.`);
  lines.push('');
  lines.push(`Head → base: \`${pr.headRef}\` → \`${pr.baseRef}\`.`);
  if (cwd) lines.push(`Workspace: \`${cwd}\`.`);
  if (pr.url) lines.push(`URL: ${pr.url}`);
  lines.push('');

  const body = pr.body.trim();
  if (body) {
    lines.push('## Description');
    lines.push(body);
    lines.push('');
  }

  if (pr.commits.length) {
    lines.push('## Commits');
    for (const commit of pr.commits) {
      const sha = commit.sha.slice(0, 7);
      lines.push(`- \`${sha}\` ${commit.subject}`);
    }
    lines.push('');
  }

  lines.push(
    'Walk the six review dimensions (correctness, security, performance, maintainability, style, tests).',
    'Return structured JSON: summary (verdict + counts), findings (title, detail with a concrete suggested fix, severity, paths), artifacts.',
    'You are unattended: do not ask questions or switch modes.',
    '',
  );

  if (patch.length <= PR_REVIEW_PATCH_BUDGET) {
    lines.push('## Diff');
    lines.push('```diff');
    lines.push(patch || '(empty diff)');
    lines.push('```');
    return lines.join('\n');
  }

  const files = parsePatchFiles(patch);
  lines.push('## Changed files');
  lines.push('The full patch exceeds the task budget. File table:');
  lines.push('');
  lines.push('| Path | + | − |');
  lines.push('| --- | ---: | ---: |');
  for (const file of files) {
    lines.push(`| \`${file.path}\` | ${file.additions} | ${file.deletions} |`);
  }
  lines.push('');

  const remaining = new Set(files.map((f) => f.path));
  let used = lines.join('\n').length;
  const sorted = [...files].sort(
    (a, b) => b.body.length - a.body.length || b.additions + b.deletions - (a.additions + a.deletions),
  );

  const inlined: PatchFileStat[] = [];
  for (const file of sorted) {
    const block = formatInlinedFile(file);
    if (used + block.length > PR_REVIEW_PATCH_BUDGET) continue;
    inlined.push(file);
    remaining.delete(file.path);
    used += block.length;
  }

  if (inlined.length) {
    lines.push('## Largest diffs that fit');
    for (const file of inlined) {
      lines.push(formatInlinedFile(file));
    }
  }

  if (remaining.size) {
    lines.push('## Remaining files');
    lines.push(
      `The following paths did not fit. Pull each with \`git diff ${pr.baseRef}...${pr.headRef} -- <path>\` via \`execute_command\`:`,
    );
    for (const path of remaining) {
      lines.push(`- \`${path}\``);
    }
  }

  return lines.join('\n');
}

/** Split a unified diff into per-file bodies and +/- counts. */
export function parsePatchFiles(patch: string): PatchFileStat[] {
  const files: PatchFileStat[] = [];
  const chunks = patch.split(/^diff --git /m);
  for (const chunk of chunks) {
    const body = chunk.trim();
    if (!body) continue;
    const withHeader = body.startsWith('a/') || body.startsWith('b/') ? `diff --git ${body}` : body;
    const path = pathFromDiffHeader(withHeader);
    if (!path) continue;
    let additions = 0;
    let deletions = 0;
    for (const line of withHeader.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('+++ ') || line.startsWith('diff ')) {
        continue;
      }
      if (line.startsWith('+')) additions += 1;
      else if (line.startsWith('-')) deletions += 1;
    }
    files.push({ path, additions, deletions, body: withHeader });
  }
  return files;
}

function pathFromDiffHeader(block: string): string | null {
  const gitLine = block.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  if (gitLine?.[2]) return gitLine[2].trim();
  const plusPlus = block.match(/^\+\+\+ b\/(.+)$/m);
  if (plusPlus?.[1]) return plusPlus[1].trim();
  const minusMinus = block.match(/^--- a\/(.+)$/m);
  if (minusMinus?.[1] && minusMinus[1] !== '/dev/null') return minusMinus[1].trim();
  return null;
}

function formatInlinedFile(file: PatchFileStat): string {
  return ['', `### \`${file.path}\` (+${file.additions} / −${file.deletions})`, '```diff', file.body, '```', ''].join(
    '\n',
  );
}
