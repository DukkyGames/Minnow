/** Built-in repo skills vs user ~/.speedchat/skills. */
export type SkillSource = 'builtin' | 'user';

/** Catalog row for slash picker (no body). */
export interface SkillListItem {
  id: string;
  label: string;
  description: string;
  source: SkillSource;
  path?: string;
  version?: string;
}

/** Full skill for send-path injection. */
export interface SkillDetail extends SkillListItem {
  body: string;
  /** Full SKILL.md source when loaded from API (editor). */
  raw?: string;
  disableModelInvocation?: boolean;
}

/** Resolved skill for the current send turn. */
export interface ActiveSkill {
  id: string;
  body: string;
  label: string;
}
