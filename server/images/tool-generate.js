/**
 * Agent-facing generate_image tool — saves to gallery and returns ids.
 */

import { generateImages } from './providers.js';
import { saveImageBytes } from './store.js';

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolGenerateImage(args) {
  const prompt = String(args?.prompt ?? '').trim();
  if (!prompt) {
    return 'Error: prompt is required.';
  }

  const albumId = args?.album ? String(args.album).trim() : undefined;

  try {
    const generated = await generateImages({
      prompt,
      providerId: args?.providerId ? String(args.providerId) : undefined,
      model: args?.model ? String(args.model) : undefined,
      size: args?.size ? String(args.size) : undefined,
    });

    const imageIds = [];
    const attachments = [];

    for (const item of generated) {
      const image = await saveImageBytes({
        bytes: item.bytes,
        prompt,
        providerId: item.providerId,
        model: item.model,
        params: item.params,
        albumId,
      });
      imageIds.push(image.id);
      attachments.push({
        type: 'image',
        url: `/api/images/${image.id}/file`,
        galleryId: image.id,
      });
    }

    return JSON.stringify({
      ok: true,
      imageIds,
      attachments,
      message: `Generated ${imageIds.length} image(s) and saved to gallery.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}
