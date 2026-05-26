/**
 * Deterministic inline image + prompt for capability suite multimodal probe.
 */

import { MULTIMODAL_PROBE_IMAGE_DATA_URL } from './multimodal-probe-image.ts';
import type { ApiMessage, ContentPart } from '../../types.ts';

export { MULTIMODAL_PROBE_IMAGE_DATA_URL };

export const MULTIMODAL_PROBE_PROMPT =
  'Describe this image in detail: the subject, colors, setting, and any notable features. Reply with at least two complete sentences.';

export const MULTIMODAL_PROBE_SYSTEM =
  'You are a vision assistant. Describe what you see clearly and completely.';

/** OpenAI-compatible user message with text + low-detail image_url. */
export function buildMultimodalProbeUserContent(): ContentPart[] {
  return [
    { type: 'text', text: MULTIMODAL_PROBE_PROMPT },
    {
      type: 'image_url',
      image_url: { url: MULTIMODAL_PROBE_IMAGE_DATA_URL, detail: 'low' },
    },
  ];
}

/** Messages for cap-multimodal runOneShot probe. */
export function buildMultimodalProbeMessages(): ApiMessage[] {
  return [
    { role: 'system', content: MULTIMODAL_PROBE_SYSTEM },
    { role: 'user', content: buildMultimodalProbeUserContent() },
  ];
}
