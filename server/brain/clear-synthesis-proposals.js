/**
 * Clear memory and skill synthesis proposal queues together.
 */

import { clearMemoryProposals } from './proposals.js';
import { clearSkillProposals } from '../skills/proposals.js';

/**
 * @param {'pending' | 'all'} [scope]
 * @returns {Promise<{ removed: number, removedMemory: number, removedSkill: number }>}
 */
export async function clearSynthesisProposals(scope = 'pending') {
  const [memory, skill] = await Promise.all([
    clearMemoryProposals(scope),
    clearSkillProposals(scope),
  ]);
  return {
    removed: memory.removed + skill.removed,
    removedMemory: memory.removed,
    removedSkill: skill.removed,
  };
}
