/** CSI and common single-byte ANSI escapes (SGR, erase, cursor, etc.). */
const CSI_ESCAPE = /\x1b\[[0-9;]*[ -/]*[@-~]/g;

/** OSC sequences (hyperlinks, window titles) terminated by BEL or ST. */
const OSC_ESCAPE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Legacy two-byte escapes (e.g. `\x1bM`). */
const SINGLE_ESCAPE = /\x1b[@-Z\\-_]/g;

/** Remove terminal color and control sequences for plain-text console panes. */
export function stripAnsi(text: string): string {
  return text.replace(OSC_ESCAPE, '').replace(CSI_ESCAPE, '').replace(SINGLE_ESCAPE, '');
}
