/**
 * Settings → Appearance: desktop wallpaper catalog and custom image upload.
 */

import {
  deleteAppearanceAsset,
  getAppearanceAssetObjectUrl,
  revokeAppearanceAssetObjectUrl,
  saveAppearanceAsset,
} from '../appearance/asset-store';
import '../styles/minnowos-wallpaper.css';

import { loadDesktopPrefs, saveDesktopPref, saveDesktopPrefs } from '../os/desktop-prefs';
import {
  renderWallpaper,
  WALLPAPER_CATALOG,
  type WallpaperImageFit,
  type WallpaperMode,
} from '../os/wallpaper';

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

export type AppearanceWallpaperOptions = {
  /** Fired after the user picks a wallpaper preset. */
  onChange?: (wallpaper: WallpaperMode) => void;
  /** Omit custom image upload (first-run onboarding keeps the step lightweight). */
  hideCustomPanel?: boolean;
};

/** Mount wallpaper thumbnail grid and custom image controls. */
export function appendAppearanceWallpaper(
  mount: HTMLElement,
  options?: AppearanceWallpaperOptions,
): void {
  const prefs = loadDesktopPrefs();
  const grid = el('div', 'settings-appearance-wallpaper-grid');
  grid.setAttribute('role', 'list');
  const buttons: HTMLButtonElement[] = [];

  async function paintPreview(
    preview: HTMLElement,
    mode: WallpaperMode,
    imageUrl?: string | null,
  ): Promise<void> {
    preview.replaceChildren();
    const inner = el('div', 'settings-appearance-wallpaper-preview-inner mn-os');
    preview.appendChild(inner);
    renderWallpaper(inner, {
      mode,
      imageUrl: imageUrl ?? undefined,
      imageFit: prefs.wallpaperImageFit ?? 'cover',
      preview: true,
    });
  }

  function refreshActive(): void {
    const current = loadDesktopPrefs();
    for (const btn of buttons) {
      const id = btn.dataset.wallpaper as WallpaperMode;
      btn.classList.toggle('is-active', id === current.wallpaper);
      btn.setAttribute('aria-pressed', String(id === current.wallpaper));
    }
  }

  for (const item of WALLPAPER_CATALOG) {
    if (options?.hideCustomPanel && item.id === 'custom') continue;

    const btn = el('button', 'settings-appearance-wallpaper-card');
    btn.type = 'button';
    btn.dataset.wallpaper = item.id;
    btn.setAttribute('role', 'listitem');

    const preview = el('div', 'settings-appearance-wallpaper-preview');
    void paintPreview(preview, item.id === 'custom' ? 'gradient' : item.id);

    const meta = el('div', 'settings-appearance-wallpaper-card__meta');
    meta.appendChild(el('span', 'settings-appearance-wallpaper-card__label', item.label));
    if (item.animated) {
      meta.appendChild(el('span', 'settings-appearance-wallpaper-card__tag', 'Animated'));
    }

    btn.append(preview, meta);
    btn.addEventListener('click', () => {
      saveDesktopPref('wallpaper', item.id);
      refreshActive();
      options?.onChange?.(item.id);
    });
    buttons.push(btn);
    grid.appendChild(btn);
  }

  mount.appendChild(grid);

  if (options?.hideCustomPanel) {
    refreshActive();
    return;
  }

  const customPanel = el('div', 'settings-appearance-wallpaper-custom');
  customPanel.appendChild(
    el('span', 'settings-appearance-wallpaper-custom__label', 'Custom image'),
  );

  const fitRow = el('div', 'settings-appearance-font-row');
  fitRow.appendChild(el('span', 'settings-appearance-font-row__label', 'Image fit'));
  const fitSelect = el('select', 'settings-select settings-appearance-fit-select');
  for (const fit of ['cover', 'contain'] as const) {
    const opt = document.createElement('option');
    opt.value = fit;
    opt.textContent = fit === 'cover' ? 'Cover' : 'Contain';
    if ((prefs.wallpaperImageFit ?? 'cover') === fit) opt.selected = true;
    fitSelect.appendChild(opt);
  }
  fitSelect.addEventListener('change', () => {
    saveDesktopPref('wallpaperImageFit', fitSelect.value as WallpaperImageFit);
  });
  fitRow.appendChild(fitSelect);
  customPanel.appendChild(fitRow);

  const uploadLabel = el('label', 'settings-action-btn');
  uploadLabel.textContent = 'Upload wallpaper image';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp';
  fileInput.hidden = true;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const prev = loadDesktopPrefs().wallpaperImageId;
      if (prev) {
        revokeAppearanceAssetObjectUrl(prev);
        await deleteAppearanceAsset(prev);
      }
      const assetId = await saveAppearanceAsset('wallpaper', file);
      saveDesktopPrefs({
        ...loadDesktopPrefs(),
        wallpaper: 'custom',
        wallpaperImageId: assetId,
      });
      refreshActive();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(msg);
    }
  });
  uploadLabel.appendChild(fileInput);
  uploadLabel.addEventListener('click', () => fileInput.click());
  customPanel.appendChild(uploadLabel);

  if (prefs.wallpaperImageId) {
    const clearBtn = el('button', 'settings-action-btn', 'Remove custom image');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', async () => {
      const id = loadDesktopPrefs().wallpaperImageId;
      if (id) {
        revokeAppearanceAssetObjectUrl(id);
        await deleteAppearanceAsset(id);
      }
      saveDesktopPrefs({
        ...loadDesktopPrefs(),
        wallpaper: 'underwater',
        wallpaperImageId: undefined,
      });
      refreshActive();
    });
    customPanel.appendChild(clearBtn);

    void getAppearanceAssetObjectUrl(prefs.wallpaperImageId).then((url) => {
      if (!url) return;
      const customBtn = buttons.find((b) => b.dataset.wallpaper === 'custom');
      const preview = customBtn?.querySelector('.settings-appearance-wallpaper-preview');
      if (preview instanceof HTMLElement) {
        void paintPreview(preview, 'custom', url);
      }
    });
  }

  mount.appendChild(customPanel);
  refreshActive();
}
