/**
 * Curated Skills Library pack registry (MIN-474).
 * Packs are commit-pinned for reproducible browse/install.
 */

/** Trust tier shown in Settings → Skills Library. */
export type SkillsLibraryTrust = 'official' | 'community';

/** Remote pack source pinned to a specific commit. */
export interface SkillsLibraryPackSource {
  /** GitHub owner/repo slug (e.g. mattpocock/skills). */
  repo: string;
  /** Full 40-char commit SHA — never a floating branch ref. */
  commit: string;
  /** Glob patterns for locating SKILL.md files within the repo tree. */
  skillsGlobs: string[];
}

/** One curated third-party skill pack in the Skills Library. */
export interface SkillsLibraryPack {
  id: string;
  label: string;
  description: string;
  publisher: string;
  trust: SkillsLibraryTrust;
  source: SkillsLibraryPackSource;
  /** Optional user-facing note about runtime prerequisites. */
  runtimeNote?: string;
  /** Post-install patch hook id (e.g. Minnow adaptations for Matt Pocock). */
  postInstallPatch?: string;
}

/** Offline browse row for a skill inside a pack index. */
export interface SkillsLibraryIndexSkill {
  skillId: string;
  label: string;
  description: string;
  /** Repo-relative path to the skill folder (parent of SKILL.md). */
  subpath: string;
}

/** Prebuilt, commit-pinned index shipped with the app for offline browse. */
export interface SkillsLibraryPackIndex {
  packId: string;
  commit: string;
  generatedAt: string;
  skills: SkillsLibraryIndexSkill[];
}

/**
 * Curated Skills Library packs.
 * Antigravity (~1,900) and AWS Agent Toolkit are intentionally excluded —
 * users add those via the add-from-URL path (WS4b/WS4d).
 */
export const SKILLS_LIBRARY_PACKS: readonly SkillsLibraryPack[] = [
  {
    id: 'matt-pocock',
    label: 'Matt Pocock',
    description:
      'Productivity and engineering skills for planning, triage, TDD, and codebase design.',
    publisher: 'Matt Pocock',
    trust: 'official',
    source: {
      repo: 'mattpocock/skills',
      commit: '5d78bd0903420f97c791f834201e550c765699f8',
      skillsGlobs: ['skills/productivity/**', 'skills/engineering/**'],
    },
    postInstallPatch: 'matt-pocock',
  },
  {
    id: 'addy-osmani',
    label: 'Addy Osmani Agent Skills',
    description:
      'Agent skills for planning, TDD, code review, security, performance, and shipping.',
    publisher: 'Addy Osmani',
    trust: 'official',
    source: {
      repo: 'addyosmani/agent-skills',
      commit: 'fefc4075ddfd8363d3b2aa8b26e6440f1ce204c0',
      skillsGlobs: ['skills/**'],
    },
  },
  {
    id: 'superpowers',
    label: 'Superpowers',
    description:
      'Agentic skills framework for brainstorming, TDD, debugging, and plan execution.',
    publisher: 'Jesse O\'Brien (obra)',
    trust: 'official',
    source: {
      repo: 'obra/superpowers',
      commit: '3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9',
      skillsGlobs: ['skills/**'],
    },
  },
  {
    id: 'last30days',
    label: 'last30days',
    description: 'Research what people are saying about any topic across Reddit, X, and the web.',
    publisher: 'Mike Van Horn',
    trust: 'community',
    source: {
      repo: 'mvanhorn/last30days-skill',
      commit: '01aef34ca49db1ccc9caaee72913760f4468f6c1',
      skillsGlobs: ['skills/**'],
    },
    runtimeNote: 'Requires network access to external platforms (Reddit, X, web).',
  },
  {
    id: 'browserbase',
    label: 'Browserbase',
    description: 'Browser automation and web research skills powered by Browserbase.',
    publisher: 'Browserbase',
    trust: 'official',
    source: {
      repo: 'browserbase/skills',
      commit: '6afe8663693372e59e167dfa5be37932af09ae3d',
      skillsGlobs: ['skills/**'],
    },
    runtimeNote: 'Requires Browserbase CLI and a Browserbase account.',
  },
] as const;

/** All curated pack ids. */
export const SKILLS_LIBRARY_PACK_IDS = SKILLS_LIBRARY_PACKS.map((pack) => pack.id);

/** Look up a curated pack by id. */
export function getSkillsLibraryPack(packId: string): SkillsLibraryPack | undefined {
  return SKILLS_LIBRARY_PACKS.find((pack) => pack.id === packId);
}

/** Return a defensive copy of the curated pack list. */
export function listSkillsLibraryPacks(): SkillsLibraryPack[] {
  return [...SKILLS_LIBRARY_PACKS];
}
