const FRONT_MATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Shell languages allowed anywhere (especially Test steps). */
const ALLOWED_FENCE_LANGS = new Set([
  '',
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'powershell',
  'ps1',
  'cmd',
  'console',
  'terminal',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'ini',
  'xml',
  'mermaid',
  'diff',
  'patch',
  'text',
  'txt',
  'plaintext',
  'markdown',
  'md',
  'csv',
]);

/** Implementation languages that must not appear as fenced blocks in plans. */
const BLOCKED_FENCE_LANGS = new Set([
  'typescript',
  'ts',
  'tsx',
  'javascript',
  'js',
  'jsx',
  'python',
  'py',
  'rust',
  'rs',
  'go',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'cs',
  'ruby',
  'rb',
  'php',
  'sql',
  'html',
  'css',
  'scss',
  'vue',
  'svelte',
]);

const FENCED_BLOCK_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

function normalizeFenceLang(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}

function isInTestSection(body: string, blockStart: number): boolean {
  const prefix = body.slice(0, blockStart);
  const testHeading = prefix.lastIndexOf('**Test:**');
  const buildHeading = prefix.lastIndexOf('**Build:**');
  if (testHeading < 0) return false;
  return buildHeading < testHeading;
}

export function validatePlanSaveNoCodeSnippets(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const body = trimmed.replace(FRONT_MATTER_RE, '');
  let match: RegExpExecArray | null;
  FENCED_BLOCK_RE.lastIndex = 0;

  while ((match = FENCED_BLOCK_RE.exec(body)) !== null) {
    const lang = normalizeFenceLang(match[1] ?? '');
    if (ALLOWED_FENCE_LANGS.has(lang)) continue;
    if (BLOCKED_FENCE_LANGS.has(lang)) {
      return `Plan files must not include fenced ${lang || 'code'} implementation blocks. Describe changes in prose; use inline \`identifiers\` or bash/sh only in **Test:** steps.`;
    }
    if (lang && !ALLOWED_FENCE_LANGS.has(lang)) {
      const inTest = isInTestSection(body, match.index);
      if (inTest && (lang === 'bash' || lang === 'sh' || lang === 'shell')) {
        continue;
      }
      if (!inTest) {
        return `Plan files must not include fenced \`${lang}\` blocks outside **Test:** steps. Describe implementation in prose with file paths and function names.`;
      }
    }
  }

  return null;
}
