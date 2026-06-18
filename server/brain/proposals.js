/**
 * Brain wiki proposal queue (proposals.json under ~/.minnow/brain/).
 */

import { createProposals } from '../engine/proposals.js';
import { getEnginePaths } from './engine-paths.js';
import { loadSynthesisConfig } from './synthesis-config.js';

const proposals = createProposals(getEnginePaths, { loadSynthesisConfig });

export const {
  addMemoryProposal,
  listMemoryProposals,
  getMemoryProposal,
  updateMemoryProposalStatus,
  applyMemoryProposalEdits,
  countPendingMemoryProposals,
} = proposals;
