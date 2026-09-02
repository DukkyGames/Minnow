export interface ContextDocumentPreset {
  id: string;
  label: string;
  description: string;
  /** Workspace-relative paths; first existing file wins for single-file presets. */
  paths: string[];
  /** Directory preset: list and merge *.md / *.mdc when path is a folder. */
  directory?: boolean;
  defaultEnabled: boolean;
  searchKeywords: string[];
}

export const CONTEXT_DOCUMENT_PRESETS: readonly ContextDocumentPreset[] = [
  {
    id: 'agents-md',
    label: 'AGENTS.md',
    description: 'Agent instructions at the repository root.',
    paths: ['AGENTS.md'],
    defaultEnabled: true,
    searchKeywords: ['agents', 'agent', 'instructions'],
  },
  {
    id: 'context-md',
    label: 'documentation/context.md',
    description: 'Minnow architecture and subsystem reference.',
    paths: ['documentation/context.md'],
    defaultEnabled: true,
    searchKeywords: ['context', 'architecture', 'documentation'],
  },
  {
    id: 'claude-md',
    label: 'CLAUDE.md',
    description: 'Claude Code project instructions.',
    paths: ['CLAUDE.md'],
    defaultEnabled: false,
    searchKeywords: ['claude'],
  },
  {
    id: 'gemini-md',
    label: 'GEMINI.md',
    description: 'Gemini project instructions.',
    paths: ['GEMINI.md'],
    defaultEnabled: false,
    searchKeywords: ['gemini'],
  },
  {
    id: 'cursor-rules',
    label: '.cursor/rules',
    description: 'Cursor rule files (*.md, *.mdc) under .cursor/rules.',
    paths: ['.cursor/rules'],
    directory: true,
    defaultEnabled: false,
    searchKeywords: ['cursor', 'rules', 'mdc'],
  },
  {
    id: 'copilot-instructions',
    label: 'Copilot instructions',
    description: 'GitHub Copilot instruction files.',
    paths: ['.github/copilot-instructions.md', 'copilot-instructions.md'],
    defaultEnabled: false,
    searchKeywords: ['copilot', 'github'],
  },
  {
    id: 'design-md',
    label: 'DESIGN.md',
    description: 'Design system and visual tokens.',
    paths: ['DESIGN.md'],
    defaultEnabled: false,
    searchKeywords: ['design', 'tokens'],
  },
  {
    id: 'product-md',
    label: 'PRODUCT.md',
    description: 'Product purpose and positioning.',
    paths: ['PRODUCT.md'],
    defaultEnabled: false,
    searchKeywords: ['product'],
  },
] as const;

export function getContextDocumentPreset(id: string): ContextDocumentPreset | undefined {
  return CONTEXT_DOCUMENT_PRESETS.find((p) => p.id === id);
}

export function defaultEnabledPresetIds(): string[] {
  return CONTEXT_DOCUMENT_PRESETS.filter((p) => p.defaultEnabled).map((p) => p.id);
}
