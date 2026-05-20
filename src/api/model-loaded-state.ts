/** LM Studio v0 uses "loaded" / "not-loaded" for model rows. */
export function isModelLoaded(state?: string): boolean {
  return state === 'loaded';
}
