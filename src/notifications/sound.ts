/**
 * Play notification sounds via bundled assets under `public/sounds/notifications/`.
 */

import { isMinnowElectronShell } from '../tools/minnow-shell';
import { loadNotificationPrefs } from './prefs';
import type { NotificationSoundOption } from './types';

/** Available notification sounds for settings + playback. */
export const NOTIFICATION_SOUNDS: readonly NotificationSoundOption[] = [
  { id: 'none', label: 'None' },
  { id: 'chime', label: 'Chime', url: './sounds/notifications/chime.wav' },
  { id: 'ping', label: 'Ping', url: './sounds/notifications/ping.wav' },
  { id: 'soft', label: 'Soft', url: './sounds/notifications/soft.wav' },
  { id: 'pop', label: 'Pop', url: './sounds/notifications/pop.wav' },
];

let audioUnlocked = false;
let notificationAudio: HTMLAudioElement | null = null;
let unlockListenersInstalled = false;

/** Resolve sound option by id. */
export function getNotificationSound(id: string): NotificationSoundOption | undefined {
  return NOTIFICATION_SOUNDS.find((s) => s.id === id);
}

function getOrCreateNotificationAudio(): HTMLAudioElement {
  if (!notificationAudio) {
    notificationAudio = new Audio();
  }
  return notificationAudio;
}

/** Unlock autoplay after the first user gesture anywhere in the app. */
export function unlockNotificationAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const audio = getOrCreateNotificationAudio();
    const chime = getNotificationSound('chime');
    if (!chime?.url) return;
    audio.src = chime.url;
    audio.volume = 0;
    void audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 0.65;
      })
      .catch(() => {
        /* browser may still block until explicit preview */
      });
  } catch {
    /* no audio support */
  }
}

/**
 * Wire one-time pointer/keyboard listeners so notification audio can autoplay later.
 * Safe to call multiple times; listeners are installed once.
 */
export function initNotificationAudioUnlock(): void {
  if (unlockListenersInstalled || typeof document === 'undefined') return;
  unlockListenersInstalled = true;
  const unlock = () => unlockNotificationAudio();
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
}

/** True when sound should play for a new notification. */
export function shouldPlayNotificationSound(): boolean {
  const prefs = loadNotificationPrefs();
  if (!prefs.enabled || prefs.muted || !prefs.soundEnabled) return false;
  if (prefs.soundId === 'none') return false;
  if (typeof document === 'undefined') return false;
  if (document.hasFocus()) return false;
  // Electron: chime whenever the desktop window loses focus (another app, minimized, etc.).
  if (isMinnowElectronShell()) return true;
  // Browser tab: skip hidden background tabs; allow visible-but-unfocused edge cases.
  return document.visibilityState === 'visible';
}

/** Play the selected notification sound (respects prefs). */
export function playNotificationSound(forceSoundId?: string): void {
  const prefs = loadNotificationPrefs();
  const soundId = forceSoundId ?? prefs.soundId;
  if (soundId === 'none') return;
  const sound = getNotificationSound(soundId);
  if (!sound?.url) return;

  try {
    const audio = getOrCreateNotificationAudio();
    audio.src = sound.url;
    audio.volume = 0.65;
    void audio.play().catch(() => {
      /* autoplay blocked until user interacts */
    });
  } catch {
    /* no audio support */
  }
}

/** Preview sound from settings (always attempts playback). */
export function previewNotificationSound(soundId: string): void {
  unlockNotificationAudio();
  if (soundId === 'none') return;
  const sound = getNotificationSound(soundId);
  if (!sound?.url) return;

  try {
    const audio = getOrCreateNotificationAudio();
    audio.src = sound.url;
    audio.volume = 0.75;
    void audio.play().catch(() => {
      /* user may need another gesture */
    });
  } catch {
    /* no audio support */
  }
}

/** Reset module state (tests). */
export function resetNotificationSoundForTests(): void {
  audioUnlocked = false;
  notificationAudio = null;
  unlockListenersInstalled = false;
}
