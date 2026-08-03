/**
 * Client gates for maintainer / QA settings surfaces.
 */

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed === '1' || trimmed === 'true' || trimmed === 'yes';
}

/** Settings → Advanced → Board testing (requires MINNOW_DEBUG at build/runtime). */
export function isBoardTestingSettingsVisible(): boolean {
  const env =
    typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : undefined;
  return isTruthyFlag(env?.MINNOW_DEBUG);
}
