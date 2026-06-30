/**
 * Guard against Unix-only pipe targets when agents run commands through cmd.exe on Windows.
 */

/** Detect `| binary` segments in a shell command (tight list — sort/find exist on Windows). */
const PIPE_TO_UNIX_BINARY = /\|\s*(tail|head|wc|less|sed|awk|grep)\b/gi;

/**
 * Suggest alternatives when a pipe targets a Unix-only binary under cmd.exe.
 * @param {string} command Raw shell command.
 * @returns {string | null} Hint message, or null when allowed.
 */
export function assessUnixPipeOnWindows(command) {
  if (process.platform !== 'win32') return null;
  if (typeof command !== 'string' || !command.trim()) return null;

  const text = command.trim();
  const match = PIPE_TO_UNIX_BINARY.exec(text);
  if (match) {
    const binary = match[1].toLowerCase();
    const tool = binary === 'grep' ? 'the `grep` tool' : 'the `grep` tool for filtering';
    return `Error: \`${binary}\` isn't available under cmd.exe — run the command directly and let it print, or use ${tool}`;
  }
  return null;
}
