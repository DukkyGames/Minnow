/**
 * Curated Skills Library pack registry data (MIN-474).
 * Shared by registry.ts (types) and the Node skills server (MIN-475).
 * Packs are commit-pinned for reproducible browse/install.
 */

/**
 * Curated Skills Library packs.
 * Antigravity (~1,900) and AWS Agent Toolkit are intentionally excluded —
 * users add those via the add-from-URL path (WS4b/WS4d).
 * @type {readonly import('./registry.ts').SkillsLibraryPack[]}
 */
export const SKILLS_LIBRARY_PACKS = [
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
];

/** @type {readonly string[]} */
export const SKILLS_LIBRARY_PACK_IDS = SKILLS_LIBRARY_PACKS.map((pack) => pack.id);

/**
 * @param {string} packId
 * @returns {import('./registry.ts').SkillsLibraryPack | undefined}
 */
export function getSkillsLibraryPack(packId) {
  return SKILLS_LIBRARY_PACKS.find((pack) => pack.id === packId);
}

/** @returns {import('./registry.ts').SkillsLibraryPack[]} */
export function listSkillsLibraryPacks() {
  return [...SKILLS_LIBRARY_PACKS];
}
