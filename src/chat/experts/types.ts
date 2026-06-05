/**
 * Expert system types: metadata, selection, and config.
 */

export type ExpertAccent =
  | 'sage'
  | 'amber'
  | 'cyan'
  | 'coral'
  | 'violet'
  | 'rose';

export const EXPERT_ACCENT_VALUES: readonly ExpertAccent[] = [
  'sage',
  'amber',
  'cyan',
  'coral',
  'violet',
  'rose',
] as const;

export interface ExpertMeta {
  id: string;
  label: string;
  kind: 'expert';
  description?: string;
  icon?: string;
  accent?: ExpertAccent;
  tagline?: string;
  greeting?: string;
}

export interface ExpertRecord {
  meta: ExpertMeta;
  fullBody: string;
  liteBody?: string;
  source: 'builtin' | 'user';
}

export type ExpertSelectionMode = 'auto' | 'manual';

export interface ExpertSelection {
  mode: ExpertSelectionMode;
  expertId: string | null;
}

export interface ExpertsConfig {
  enabled: boolean;
}

export const DEFAULT_EXPERTS_CONFIG: ExpertsConfig = {
  enabled: true,
};
