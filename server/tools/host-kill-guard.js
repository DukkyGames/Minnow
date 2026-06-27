/**
 * Guard against agent shell commands that would kill the running Minnow host.
 *
 * Work-agents sometimes try to "free a port from a prior run" by killing
 * electron.exe / Minnow.exe or whatever owns the dev port — but that process is
 * the live app hosting this very agent, so the agent ends up killing Minnow.
 * Block those commands before they reach the shell (agent path only; the user's
 * manual terminal is unaffected).
 */

import { resolveMinnowPort } from '../constants/minnow-port.js';
import { getSchedulerServerBaseUrl } from '../scheduler/server-base-url.js';

/** Process kill verbs across PowerShell / cmd / POSIX shells. */
const KILL_VERB = /\b(taskkill|tskill|stop-process|spps|pkill|killall|kill|fuser)\b/i;

/** Image names that belong to the Minnow host (UI shell + electron runtime). */
const HOST_IMAGE = /\b(minnow|electron)(\.exe)?\b/i;

/** Port-inspection tools that are commonly piped into a kill. */
const PORT_TOOL = /\b(get-nettcpconnection|netstat|lsof|fuser)\b|-localport\b/i;

/** Resolve the dev port the running server actually bound to. */
function liveDevPort() {
  try {
    const { port } = new URL(getSchedulerServerBaseUrl());
    if (port) return port;
  } catch {
    /* fall through to env/default */
  }
  return String(resolveMinnowPort());
}

/** True when the command references the live dev port in a port position. */
function mentionsPort(command, port) {
  if (!port) return false;
  // :9473 | LocalPort 9473 | lsof -ti:9473 | port 9473 | 9473/tcp
  const re = new RegExp(
    `(?::|\\bport\\s+|-localport\\s+|-ti:)${port}\\b|\\b${port}/(?:tcp|udp)\\b`,
    'i',
  );
  return re.test(command);
}

/** PIDs whose death takes down the host (the node server process tree). */
function protectedPids() {
  const pids = new Set();
  if (process.pid) pids.add(String(process.pid));
  if (process.ppid) pids.add(String(process.ppid));
  return pids;
}

/** True when a PID-targeted kill names one of the host's own PIDs. */
function targetsHostPid(command, pids) {
  const matches = command.matchAll(
    /(?:\/pid\s+|-id\s+|\bkill(?:\s+-\w+)*\s+)(\d{2,7})/gi,
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
 * Returns an error message when a command would kill the Minnow host, else null.
 *
 * @param {string} command Raw shell command an agent wants to run.
 * @returns {string | null}
 */
export function assessHostKillCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const text = command.trim();

  const hasKillVerb = KILL_VERB.test(text);
  const port = liveDevPort();

  // Image-name kills: taskkill /IM electron.exe, pkill -f electron, killall Minnow.
  if (hasKillVerb && HOST_IMAGE.test(text)) {
    return hostKillError(port);
  }

  // Port-owner kills: Get-NetTCPConnection -LocalPort <livePort> | Stop-Process,
  // lsof -ti:<livePort> | xargs kill, fuser -k <livePort>/tcp. A stale prior run lives on a
  // *different* (auto-incremented) port, so matching only the live port is safe.
  if ((hasKillVerb || PORT_TOOL.test(text)) && mentionsPort(text, port)) {
    return hostKillError(port);
  }

  // PID kills aimed at the host server process tree.
  if (hasKillVerb && targetsHostPid(text, protectedPids())) {
    return hostKillError(port);
  }

  return null;
}
