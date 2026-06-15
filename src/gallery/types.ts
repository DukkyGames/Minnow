/**
 * Gallery types — metadata persisted under ~/.minnow/gallery/.
 */

export interface GalleryAlbum {
  id: string;
  name: string;
  createdAt: string;
}

export type GalleryProvenance = 'generated' | 'imported';

export interface GalleryImage {
  id: string;
  albumId: string;
  prompt: string;
  negativePrompt?: string;
  providerId?: string;
  model?: string;
  params: Record<string, unknown>;
  filePath: string;
  thumbnailPath?: string;
  width?: number;
  height?: number;
  createdAt: string;
  provenance: GalleryProvenance;
}

export interface GalleryStats {
  imageCount: number;
  albumCount: number;
  totalBytes: number;
  maxImages: number;
  maxGalleryBytes: number;
  maxFileBytes: number;
}

export interface GenerateImageRequest {
  prompt: string;
  negativePrompt?: string;
  providerId?: string;
  model?: string;
  size?: string;
  count?: number;
  albumId?: string;
}
