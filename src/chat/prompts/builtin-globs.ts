export const BUILTIN_RAW = import.meta.glob<string>('./**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
