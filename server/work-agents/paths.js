/**
 * Safe paths for Work Agent user data under SPEEDCHAT_HOME.
 */

import path from 'node:path';
import { getSpeedChatHome } from '../config/home.js';

const AGENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Validate work agent id segment (no traversal).
 * @param {string} agentId
 */
export function assertValidWorkAgentId(agentId) {
  if (!agentId || typeof agentId !== 'string' || !AGENT_ID_RE.test(agentId)) {
    throw new Error('Invalid work agent id');
  }
}

/**
 * ~/.speedchat/work-agents.json
 */
export function workAgentsOverridesPath() {
  return path.join(getSpeedChatHome(), 'work-agents.json');
}

/**
 * ~/.speedchat/prompts/work-agents/<id>/agent.<profile>.md
 * @param {string} agentId
 * @param {'full'|'lite'} profile
 */
export function workAgentPromptOverridePath(agentId, profile) {
  assertValidWorkAgentId(agentId);
  if (profile !== 'full' && profile !== 'lite') {
    throw new Error('Invalid profile');
  }
  const home = path.resolve(getSpeedChatHome());
  const rel = path.join('prompts', 'work-agents', agentId, `agent.${profile}.md`);
  const full = path.resolve(home, rel);
  const homeWithSep = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  if (full !== home && !full.startsWith(homeWithSep)) {
    throw new Error('Invalid path');
  }
  return full;
}

/**
 * Shipped prompts under repo src/chat/prompts/work-agents/
 * @param {string} projectRoot
 * @param {string} agentId
 * @param {'full'|'lite'} profile
 */
export function builtinWorkAgentPromptPath(projectRoot, agentId, profile) {
  assertValidWorkAgentId(agentId);
  if (profile !== 'full' && profile !== 'lite') {
    throw new Error('Invalid profile');
  }
  const root = path.resolve(projectRoot);
  const rel = path.join('src', 'chat', 'prompts', 'work-agents', agentId, `agent.${profile}.md`);
  const full = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new Error('Invalid path');
  }
  return full;
}

export function builtinWorkAgentsDir(projectRoot) {
  return path.join(projectRoot, 'src', 'chat', 'prompts', 'work-agents');
}
