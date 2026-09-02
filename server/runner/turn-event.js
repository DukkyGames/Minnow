/**
 * @param {unknown} type
 * @returns {boolean}
 */
export function isHighFrequencyTurnEvent(type) {
  switch (type) {
    case 'stream_meta':
    case 'phase':
    case 'round_start':
    case 'reasoning_end':
    case 'token':
    case 'delta':
    case 'reasoning_delta':
      return true;
    default:
      return false;
  }
}

/**
 * @param {unknown} type
 * @returns {boolean}
 */
export function shouldEmitSubAgentLiveTurnEvent(type) {
  if (type === 'phase') return true;
  return !isHighFrequencyTurnEvent(type);
}
