/**
 * Vite-only: bundle all shipped prompt markdown as raw strings.
 * Do not import this module from Node tests (use registerPromptFilesFromRaw).
 */

export const BUILTIN_RAW = import.meta.glob<string>('./**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
