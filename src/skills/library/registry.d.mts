import type { SkillsLibraryPack } from './registry';

export const SKILLS_LIBRARY_PACKS: readonly SkillsLibraryPack[];
export const SKILLS_LIBRARY_PACK_IDS: readonly string[];
export function getSkillsLibraryPack(packId: string): SkillsLibraryPack | undefined;
export function listSkillsLibraryPacks(): SkillsLibraryPack[];
