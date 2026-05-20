/**
 * Format LSP diagnostics for LLM consumption (deterministic ordering).
 */

const MAX_DIAGNOSTICS = 50;

/**
 * @param {string} filePath
 * @param {Array<{ severity?: number, message?: string, range?: { start?: { line?: number, character?: number } }, source?: string }>} diagnostics
 */
export function formatDiagnostics(filePath, diagnostics) {
  if (!diagnostics?.length) {
    return `No LSP diagnostics for ${filePath}.`;
  }

  const severityLabel = (s) => {
    if (s === 1) return 'Error';
    if (s === 2) return 'Warning';
    if (s === 3) return 'Info';
    return 'Hint';
  };

  const sorted = [...diagnostics].sort((a, b) => {
    const la = a.range?.start?.line ?? 0;
    const lb = b.range?.start?.line ?? 0;
    if (la !== lb) return la - lb;
    return (a.range?.start?.character ?? 0) - (b.range?.start?.character ?? 0);
  });

  const lines = [filePath];
  const slice = sorted.slice(0, MAX_DIAGNOSTICS);
  for (const d of slice) {
    const line = (d.range?.start?.line ?? 0) + 1;
    const col = (d.range?.start?.character ?? 0) + 1;
    const src = d.source ? ` (${d.source})` : '';
    lines.push(
      `  [${severityLabel(d.severity)}] L${line}:${col} — ${d.message ?? 'unknown'}${src}`,
    );
  }
  if (sorted.length > MAX_DIAGNOSTICS) {
    lines.push(`… and ${sorted.length - MAX_DIAGNOSTICS} more`);
  }
  return lines.join('\n');
}
