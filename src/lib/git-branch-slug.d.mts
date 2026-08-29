export declare const GIT_REF_SEGMENT_MAX: number;
export declare const GIT_REF_MAX: number;
export declare const GIT_REF_FALLBACK_BRANCH: string;
export declare const GIT_REF_FALLBACK_WORKTREE: string;

export declare function pathBasename(raw: string): string;
export declare function slugifyGitRefName(raw: string, fallback?: string): string;
export declare function gitRefFolderName(ref: string): string;
export declare function suggestGitRefName(input?: {
  title?: string;
  path?: string;
  fallback?: string;
  reserved?: Iterable<string | undefined | null>;
}): string;
