import { resolveMinnowPort } from '../constants/minnow-port.js';
import { getSchedulerServerBaseUrl } from '../scheduler/server-base-url.js';

const KILL_VERB = /\b(taskkill|tskill|stop-process|spps|pkill|killall|kill|fuser)\b/i;

const HOST_IMAGE = /\b(minnow|electron)(\.exe)?\b/i;

const PORT_TOOL = /\b(get-nettcpconnection|netstat|lsof|fuser)\b|-localport\b/i;

function liveDevPort() {
  try {
    const { port } = new URL(getSchedulerServerBaseUrl());
    if (port) return port;
  } catch {
  }
  return String(resolveMinnowPort());
}

function mentionsPort(command, port) {
  if (!port) return false;
  const re = new RegExp(
    `(?::|\\bport\\s+|-localport\\s+|-ti:)${port}\\b|\\b${port}/(?:tcp|udp)\\b`,
    'i',
  );
  return re.test(command);
}

function protectedPids() {
  const pids = new Set();
  if (process.pid) pids.add(String(process.pid));
  if (process.ppid) pids.add(String(process.ppid));
  return pids;
}

function targetsHostPid(command, pids) {
  const matches = command.matchAll(
    /(?:\/pid\s+|-id\s+|\bkill(?:\s+-\w+)*\s+)(\d{2,10})/gi,
  );
  for (const m of matches) {
    if (pids.has(m[1])) return true;
  }
  return false;
}

function hostKillError(port) {
  return [
    'Error: refusing to run a command that would kill the running Minnow app',
    `(its Electron shell or the dev server on port ${port}) — that process is hosting this agent.`,
    "Minnow's dev server auto-selects the next free port, so a stale port never needs freeing:",
    'just start your verification server (it picks another port) or reuse the running one.',
    'To stop a specific stale process, target its PID — not the "electron"/"Minnow" image name or the live port.',
  ].join(' ');
}

/**
 * @param {number} pid
 * @param {number} [port]
 */
export function isProtectedPortOwner(pid, port) {
  const pidStr = String(Math.floor(Number(pid)));
  if (protectedPids().has(pidStr)) return true;
  const live = Number(liveDevPort());
  if (port != null && Number.isFinite(Number(port)) && Number(port) === live) return true;
  return false;
}

/**
 * @param {number} pid
 * @param {number} [port]
 * @returns {string | null}
 */
export function assessPortOwnerKill(pid, port) {
  if (!Number.isFinite(Number(pid)) || Number(pid) <= 0) {
    return 'Error: pid is required';
  }
  if (isProtectedPortOwner(pid, port)) {
    return hostKillError(liveDevPort());
  }
  return null;
}

/**
 * @param {string} command
 * @returns {string | null}
 */
export function assessHostKillCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const text = command.trim();

  const hasKillVerb = KILL_VERB.test(text);
  const port = liveDevPort();

  if (hasKillVerb && HOST_IMAGE.test(text)) {
    return hostKillError(port);
  }

  if ((hasKillVerb || PORT_TOOL.test(text)) && mentionsPort(text, port)) {
    return hostKillError(port);
  }

  if (hasKillVerb && targetsHostPid(text, protectedPids())) {
    return hostKillError(port);
  }

  return null;
}
