/**
 * Gallery panel — generate form, album filter, grid, and detail view.
 */

import {
  cleanupGallery,
  createGalleryAlbum,
  deleteGalleryImage,
  fetchGalleryAlbums,
  fetchGalleryImages,
  fetchGalleryStats,
  galleryImageFileUrl,
  galleryImageThumbUrl,
  generateGalleryImages,
} from '../../gallery/client';
import type { GalleryAlbum, GalleryImage } from '../../gallery/types';
import { listProviders } from '../../providers/store';
import { isLocalServerAvailable } from '../../tools/config';

export interface GalleryPanelOptions {
  onStatus?: (state: 'ok' | 'err', message: string) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/** Render the gallery panel into the mount element. */
export async function renderGalleryPanel(
  mount: HTMLElement,
  options: GalleryPanelOptions = {},
): Promise<void> {
  const onStatus = options.onStatus;
  let albums: GalleryAlbum[] = [];
  let images: GalleryImage[] = [];
  let selectedAlbumId = '';
  let selectedImageId: string | null = null;
  let generating = false;

  const panel = el('div', 'gallery-panel');
  mount.replaceChildren(panel);

  const offline = el('p', 'gallery-offline', 'Start Minnow with npm start to use the gallery API.');
  if (!(await isLocalServerAvailable())) {
    panel.appendChild(offline);
    return;
  }

  const statsBar = el('div', 'gallery-stats-bar');
  const albumTabs = el('div', 'gallery-album-tabs');
  const generateSection = el('section', 'gallery-generate');
  const gridSection = el('section', 'gallery-grid-section');
  const detailSection = el('section', 'gallery-detail is-hidden');

  panel.append(statsBar, albumTabs, generateSection, gridSection, detailSection);

  const promptInput = el('textarea', 'gallery-prompt') as HTMLTextAreaElement;
  promptInput.rows = 2;
  promptInput.placeholder = 'Describe the image to generate…';
  promptInput.setAttribute('aria-label', 'Image prompt');

  const negativeInput = el('input', 'gallery-negative') as HTMLInputElement;
  negativeInput.type = 'text';
  negativeInput.placeholder = 'Negative prompt (optional)';
  negativeInput.setAttribute('aria-label', 'Negative prompt');

  const sizeSelect = el('select', 'gallery-size settings-select') as HTMLSelectElement;
  for (const size of ['1024x1024', '1024x1792', '1792x1024', '512x512']) {
    const opt = el('option', undefined, size) as HTMLOptionElement;
    opt.value = size;
    sizeSelect.appendChild(opt);
  }

  const providerSelect = el('select', 'gallery-provider settings-select') as HTMLSelectElement;
  const modelInput = el('input', 'gallery-model settings-input') as HTMLInputElement;
  modelInput.type = 'text';
  modelInput.placeholder = 'Model (default from config)';
  modelInput.setAttribute('aria-label', 'Image model');

  const albumSelect = el('select', 'gallery-album-select settings-select') as HTMLSelectElement;

  const generateBtn = el('button', 'is-primary gallery-generate-btn', 'Generate') as HTMLButtonElement;
  const generateStatus = el('p', 'gallery-generate-status', '');

  generateSection.append(
    el('h3', 'gallery-section-title', 'Generate'),
    promptInput,
    negativeInput,
    el('div', 'gallery-generate-row', undefined),
  );
  const generateRow = generateSection.querySelector('.gallery-generate-row')!;
  generateRow.append(sizeSelect, providerSelect, modelInput, albumSelect, generateBtn);
  generateSection.append(generateStatus);

  const grid = el('div', 'gallery-grid');
  gridSection.append(el('h3', 'gallery-section-title', 'Gallery'), grid);

  const detailImg = el('img', 'gallery-detail-img') as HTMLImageElement;
  detailImg.alt = 'Generated image';
  const detailMeta = el('div', 'gallery-detail-meta');
  const detailActions = el('div', 'gallery-detail-actions');
  detailSection.append(detailImg, detailMeta, detailActions);

  async function populateProviders(): Promise<void> {
    providerSelect.replaceChildren();
    const empty = el('option', undefined, 'Default provider') as HTMLOptionElement;
    empty.value = '';
    providerSelect.appendChild(empty);
    try {
      const { providers } = await listProviders();
      for (const p of providers) {
        const opt = el('option', undefined, p.label || p.id) as HTMLOptionElement;
        opt.value = p.id;
        providerSelect.appendChild(opt);
      }
    } catch {
      // provider list optional
    }
  }

  function populateAlbumSelects(): void {
    albumSelect.replaceChildren();
    for (const album of albums) {
      const opt = el('option', undefined, album.name) as HTMLOptionElement;
      opt.value = album.id;
      albumSelect.appendChild(opt);
    }
  }

  function renderAlbumTabs(): void {
    albumTabs.replaceChildren();
    const allTab = el('button', `gallery-album-tab${selectedAlbumId ? '' : ' is-active'}`, 'All');
    allTab.type = 'button';
    allTab.addEventListener('click', () => {
      selectedAlbumId = '';
      void refreshGrid();
      renderAlbumTabs();
    });
    albumTabs.appendChild(allTab);

    for (const album of albums) {
      const tab = el(
        'button',
        `gallery-album-tab${selectedAlbumId === album.id ? ' is-active' : ''}`,
        album.name,
      ) as HTMLButtonElement;
      tab.type = 'button';
      tab.addEventListener('click', () => {
        selectedAlbumId = album.id;
        void refreshGrid();
        renderAlbumTabs();
      });
      albumTabs.appendChild(tab);
    }

    const addBtn = el('button', 'gallery-album-add', '+ Album') as HTMLButtonElement;
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => {
      const name = window.prompt('Album name');
      if (!name?.trim()) return;
      void createGalleryAlbum(name.trim())
        .then((album) => {
          albums.push(album);
          populateAlbumSelects();
          renderAlbumTabs();
          onStatus?.('ok', `Created album "${album.name}"`);
        })
        .catch((err) => {
          onStatus?.('err', err instanceof Error ? err.message : String(err));
        });
    });
    albumTabs.appendChild(addBtn);
  }

  function renderGrid(): void {
    grid.replaceChildren();
    if (images.length === 0) {
      grid.appendChild(el('p', 'gallery-empty', 'No images yet — generate one above.'));
      return;
    }

    for (const image of images) {
      const card = el('button', 'gallery-card', undefined) as HTMLButtonElement;
      card.type = 'button';
      card.dataset.imageId = image.id;

      const thumb = el('img', 'gallery-card-thumb') as HTMLImageElement;
      thumb.src = galleryImageThumbUrl(image.id);
      thumb.alt = image.prompt;
      thumb.loading = 'lazy';

      const caption = el('span', 'gallery-card-caption', image.prompt.slice(0, 60));

      card.append(thumb, caption);
      card.addEventListener('click', () => {
        selectedImageId = image.id;
        showDetail(image);
      });
      grid.appendChild(card);
    }
  }

  function showDetail(image: GalleryImage): void {
    detailSection.classList.remove('is-hidden');
    gridSection.classList.add('is-hidden');
    detailImg.src = galleryImageFileUrl(image.id);
    detailMeta.replaceChildren();

    const rows: Array<[string, string]> = [
      ['Prompt', image.prompt],
      ['Created', formatWhen(image.createdAt)],
      ['Provenance', image.provenance],
      ['Album', albums.find((a) => a.id === image.albumId)?.name ?? image.albumId],
    ];
    if (image.model) rows.push(['Model', image.model]);
    if (image.providerId) rows.push(['Provider', image.providerId]);
    if (image.negativePrompt) rows.push(['Negative', image.negativePrompt]);

    for (const [label, value] of rows) {
      const row = el('div', 'gallery-detail-row');
      row.append(el('span', 'gallery-detail-label', label), el('span', 'gallery-detail-value', value));
      detailMeta.appendChild(row);
    }

    detailActions.replaceChildren();

    const backBtn = el('button', undefined, '← Back') as HTMLButtonElement;
    backBtn.type = 'button';
    backBtn.addEventListener('click', () => {
      detailSection.classList.add('is-hidden');
      gridSection.classList.remove('is-hidden');
      selectedImageId = null;
    });

    const copyBtn = el('button', undefined, 'Copy prompt') as HTMLButtonElement;
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(image.prompt);
      onStatus?.('ok', 'Prompt copied');
    });

    const downloadBtn = el('a', 'is-primary', 'Download') as HTMLAnchorElement;
    downloadBtn.href = galleryImageFileUrl(image.id);
    downloadBtn.download = `${image.id}.png`;

    const deleteBtn = el('button', 'gallery-delete-btn', 'Delete') as HTMLButtonElement;
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', () => {
      if (!window.confirm('Delete this image from the gallery?')) return;
      void deleteGalleryImage(image.id)
        .then(async () => {
          onStatus?.('ok', 'Image deleted');
          detailSection.classList.add('is-hidden');
          gridSection.classList.remove('is-hidden');
          selectedImageId = null;
          await refreshAll();
        })
        .catch((err) => {
          onStatus?.('err', err instanceof Error ? err.message : String(err));
        });
    });

    detailActions.append(backBtn, copyBtn, downloadBtn, deleteBtn);
  }

  async function refreshStats(): Promise<void> {
    try {
      const stats = await fetchGalleryStats();
      statsBar.replaceChildren();
      statsBar.append(
        el('span', 'gallery-stat', `${stats.imageCount} / ${stats.maxImages} images`),
        el('span', 'gallery-stat', formatBytes(stats.totalBytes)),
        el('span', 'gallery-stat', `${stats.albumCount} albums`),
      );

      const cleanupBtn = el('button', 'gallery-cleanup-btn', 'Run cleanup') as HTMLButtonElement;
      cleanupBtn.type = 'button';
      cleanupBtn.addEventListener('click', () => {
        void cleanupGallery()
          .then(async (result) => {
            onStatus?.(
              'ok',
              result.deletedIds.length
                ? `Removed ${result.deletedIds.length} image(s), freed ${formatBytes(result.freedBytes)}`
                : 'Gallery within limits',
            );
            await refreshAll();
          })
          .catch((err) => {
            onStatus?.('err', err instanceof Error ? err.message : String(err));
          });
      });
      statsBar.appendChild(cleanupBtn);
    } catch {
      statsBar.textContent = 'Gallery stats unavailable';
    }
  }

  async function refreshGrid(): Promise<void> {
    const result = await fetchGalleryImages({
      albumId: selectedAlbumId || undefined,
      limit: 100,
    });
    images = result.images;
    renderGrid();
    if (selectedImageId) {
      const image = images.find((img) => img.id === selectedImageId);
      if (image) showDetail(image);
    }
  }

  async function refreshAll(): Promise<void> {
    albums = await fetchGalleryAlbums();
    populateAlbumSelects();
    renderAlbumTabs();
    await refreshStats();
    await refreshGrid();
  }

  generateBtn.addEventListener('click', () => {
    if (generating) return;
    const prompt = promptInput.value.trim();
    if (!prompt) {
      onStatus?.('err', 'Enter a prompt');
      return;
    }

    generating = true;
    generateBtn.disabled = true;
    generateStatus.textContent = 'Generating…';
    generateStatus.classList.remove('is-err');

    void generateGalleryImages({
      prompt,
      negativePrompt: negativeInput.value.trim() || undefined,
      size: sizeSelect.value,
      providerId: providerSelect.value || undefined,
      model: modelInput.value.trim() || undefined,
      albumId: albumSelect.value || undefined,
    })
      .then(async (saved) => {
        generateStatus.textContent = `Saved ${saved.length} image(s)`;
        onStatus?.('ok', `Generated ${saved.length} image(s)`);
        await refreshAll();
        if (saved[0]) {
          selectedImageId = saved[0].id;
          showDetail(saved[0]);
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        generateStatus.textContent = message;
        generateStatus.classList.add('is-err');
        onStatus?.('err', message);
      })
      .finally(() => {
        generating = false;
        generateBtn.disabled = false;
      });
  });

  await populateProviders();
  await refreshAll();
}
