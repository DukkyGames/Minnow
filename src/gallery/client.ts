/**
 * Browser client for gallery API (/api/images/*).
 */

import type {
  GalleryAlbum,
  GalleryImage,
  GalleryStats,
  GenerateImageRequest,
} from './types';

/** Whether the gallery API is reachable. */
export async function pingGalleryApi(): Promise<boolean> {
  try {
    const res = await fetch('/api/images/ping');
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** List gallery albums. */
export async function fetchGalleryAlbums(): Promise<GalleryAlbum[]> {
  const res = await fetch('/api/images/albums');
  if (!res.ok) {
    throw new Error(`Failed to load albums (${res.status})`);
  }
  const body = (await res.json()) as { albums?: GalleryAlbum[] };
  return body.albums ?? [];
}

/** Create a new album. */
export async function createGalleryAlbum(name: string): Promise<GalleryAlbum> {
  const res = await fetch('/api/images/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to create album (${res.status})`);
  }
  const body = (await res.json()) as { album: GalleryAlbum };
  return body.album;
}

/** List images with optional album filter. */
export async function fetchGalleryImages(options?: {
  albumId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ images: GalleryImage[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.albumId) params.set('albumId', options.albumId);
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.offset != null) params.set('offset', String(options.offset));
  const qs = params.toString();
  const res = await fetch(`/api/images${qs ? `?${qs}` : ''}`);
  if (!res.ok) {
    throw new Error(`Failed to load images (${res.status})`);
  }
  return (await res.json()) as { images: GalleryImage[]; total: number };
}

/** Fetch one image's metadata. */
export async function fetchGalleryImage(id: string): Promise<GalleryImage> {
  const res = await fetch(`/api/images/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Image not found (${res.status})`);
  }
  const body = (await res.json()) as { image: GalleryImage };
  return body.image;
}

/** Generate and save images. */
export async function generateGalleryImages(
  request: GenerateImageRequest,
): Promise<GalleryImage[]> {
  const res = await fetch('/api/images/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Generation failed (${res.status})`);
  }
  const body = (await res.json()) as { images: GalleryImage[] };
  return body.images ?? [];
}

/** Delete an image from the gallery. */
export async function deleteGalleryImage(id: string): Promise<void> {
  const res = await fetch(`/api/images/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Delete failed (${res.status})`);
  }
}

/** Run cleanup to enforce gallery caps. */
export async function cleanupGallery(): Promise<{ deletedIds: string[]; freedBytes: number }> {
  const res = await fetch('/api/images/cleanup', { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Cleanup failed (${res.status})`);
  }
  return (await res.json()) as { deletedIds: string[]; freedBytes: number };
}

/** Gallery disk usage stats. */
export async function fetchGalleryStats(): Promise<GalleryStats> {
  const res = await fetch('/api/images/stats');
  if (!res.ok) {
    throw new Error(`Failed to load stats (${res.status})`);
  }
  const body = (await res.json()) as { stats: GalleryStats };
  return body.stats;
}

/** URL for full-size image bytes. */
export function galleryImageFileUrl(id: string): string {
  return `/api/images/${encodeURIComponent(id)}/file`;
}

/** URL for thumbnail (v1 serves full image). */
export function galleryImageThumbUrl(id: string): string {
  return `/api/images/${encodeURIComponent(id)}/thumbnail`;
}
