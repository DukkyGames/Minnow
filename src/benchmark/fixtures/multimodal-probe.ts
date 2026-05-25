/**
 * Deterministic inline image + prompt for capability suite multimodal probe.
 */

import type { ApiMessage, ContentPart } from '../../types.ts';

/** 1×1 solid red PNG (minimal payload, no filesystem reads). */
export const MULTIMODAL_PROBE_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ZkAAAAASUVORK5CYII=';

export const MULTIMODAL_PROBE_PROMPT =
  'What is the dominant color in this image? Reply with one word only.';

export const MULTIMODAL_PROBE_SYSTEM =
  'You are a vision assistant. Answer briefly.';

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
