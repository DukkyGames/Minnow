/**
 * Shared git / worktree icon paths (24×24 viewBox, currentColor fill) — MIN-276.
 * Used in composer run-target controls, git panel, board, and sidebar.
 */

/** Monitor icon for local / run-on-this-PC target. */
export const GIT_LOCAL_ICON_PATH =
  'M5,19h6v2H7a1,1,0,0,0,0,2H17a1,1,0,0,0,0-2H13V19h6a5.009,5.009,0,0,0,4.9-4H.1A5.009,5.009,0,0,0,5,19Z M19,1H5A5.006,5.006,0,0,0,0,6v7H24V6A5.006,5.006,0,0,0,19,1Z';

/** Branch icon for git branch selectors. */
export const GIT_BRANCH_ICON_PATH =
  'M24,4c0-2.206-1.794-4-4-4s-4,1.794-4,4c0,1.86,1.277,3.428,3,3.873v.127c0,1.654-1.346,3-3,3H8c-1.125,0-2.164,.374-3,1.002V7.873c1.723-.445,3-2.013,3-3.873C8,1.794,6.206,0,4,0S0,1.794,0,4c0,1.86,1.277,3.428,3,3.873v8.253c-1.723,.445-3,2.013-3,3.873,0,2.206,1.794,4,4,4s4-1.794,4-4c0-1.86-1.277-3.428-3-3.873v-.127c0-1.654,1.346-3,3-3h8c2.757,0,5-2.243,5-5v-.127c1.723-.445,3-2.013,3-3.873Z';

/** Worktree icon for isolated git worktree targets. */
export const GIT_WORKTREE_ICON_PATH =
  'm24 12c0 .552-.448 1-1 1h-5c-.552 0-1-.448-1-1s.448-1 1-1h5c.552 0 1 .448 1 1zm-1 8h-5c-.552 0-1 .448-1 1s.448 1 1 1h5c.552 0 1-.448 1-1s-.448-1-1-1zm-13-16h13c.552 0 1-.448 1-1s-.448-1-1-1h-13c-.552 0-1 .448-1 1s.448 1 1 1zm4 7v2c0 1.103-.897 2-2 2h-2c-1.103 0-2-.897-2-2h-4v5c0 1.103.897 2 2 2h2c0-1.103.897-2 2-2h2c1.103 0 2 .897 2 2v2c0 1.103-.897 2-2 2h-2c-1.103 0-2-.897-2-2h-2c-2.206 0-4-1.794-4-4v-12c-1.103 0-2-.897-2-2v-2c0-1.103.897-2 2-2h2c1.103 0 2 .897 2 2v2c0 1.103-.897 2-2 2v5h4c0-1.103.897-2 2-2h2c1.103 0 2 .897 2 2z';

export type GitWorktreeIconKind = 'local' | 'branch' | 'worktree';

const PATH_BY_KIND: Record<GitWorktreeIconKind, string> = {
  local: GIT_LOCAL_ICON_PATH,
  branch: GIT_BRANCH_ICON_PATH,
  worktree: GIT_WORKTREE_ICON_PATH,
};

/** Create a fill-based SVG icon for local / branch / worktree concepts. */
export function createGitWorktreeIcon(
  kind: GitWorktreeIconKind,
  className = 'icon-svg',
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATH_BY_KIND[kind]);
  // Inherit button text color (same pattern as composer .icon-svg stroke icons).
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}
