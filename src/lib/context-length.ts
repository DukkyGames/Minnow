import { isModelLoaded } from '../api/model-loaded-state';

/** Context window from a models-list row: configured length when loaded, else catalog max. */
export function contextLengthFromModelRow(row: {
  state?: string;
  loaded_context_length?: number;
  max_context_length?: number;
  capabilities?: { contextLength?: number | null };
}): number | undefined {
  const fromCaps = row.capabilities?.contextLength;
  if (typeof fromCaps === 'number' && Number.isFinite(fromCaps) && fromCaps > 0) {
    return fromCaps;
  }
  if (isModelLoaded(row.state)) {
    const loaded = row.loaded_context_length;
    if (typeof loaded === 'number' && Number.isFinite(loaded) && loaded > 0) {
      return loaded;
    }
  }
  const max = row.max_context_length;
  if (typeof max === 'number' && Number.isFinite(max) && max > 0) {
    return max;
  }
  return undefined;
}
