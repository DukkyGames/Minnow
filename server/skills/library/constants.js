/**
 * Skills Library install limits and GitHub host allowlist (MIN-475).
 */

/** Hosts permitted for Skills Library network fetches. */
export const SKILLS_LIBRARY_GITHUB_HOSTS = new Set([
  'api.github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
]);

/** Max files per installed skill directory. */
export const SKILLS_LIBRARY_MAX_FILES_PER_SKILL = 50;

/** Max total bytes per installed skill directory. */
export const SKILLS_LIBRARY_MAX_BYTES_PER_SKILL = 2 * 1024 * 1024;

/** Max bytes for a single fetched file. */
export const SKILLS_LIBRARY_MAX_BYTES_PER_FILE = 512 * 1024;

/** User-Agent for GitHub API/raw requests. */
export const SKILLS_LIBRARY_USER_AGENT = 'minnow-skills-library';
