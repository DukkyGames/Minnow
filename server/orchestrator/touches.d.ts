export function listRepoFiles(root?: string): Promise<string[]>;

export function attachTouchesExpansion(
  tasks: Array<Record<string, unknown> & { touches?: string[] }>,
  repoFiles: readonly string[],
): Array<Record<string, unknown>>;

export function listChangedFiles(worktree: string, baseRef?: string): Promise<string[]>;

export function captureWorktreeDiff(
  worktree: string,
  baseRef?: string,
): Promise<{
  files: string[];
  patch: string;
  truncated: boolean;
  originalLength?: number;
} | null>;

export function detectAttemptOverflow(input: {
  worktree: string | null | undefined;
  declared: readonly string[];
  baseRef?: string;
}): Promise<{ declared: string[]; actual: string[] } | null>;
