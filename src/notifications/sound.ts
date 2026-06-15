/**
 * Play notification sounds via bundled assets under `public/sounds/notifications/`.
 */

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
let previewAudio: HTMLAudioElement | null = null;

/** Resolve sound option by id. */
export function getNotificationSound(id: string): NotificationSoundOption | undefined {
  return NOTIFICATION_SOUNDS.find((s) => s.id === id);
}

/** Unlock autoplay after first user gesture (menubar interaction). */
export function unlockNotificationAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const silent = new Audio();
    silent.volume = 0;
    void silent.play().catch(() => {
      /* browser may still block until explicit preview */
    });
  } catch {
    /* no audio support */
  }
}

/** True when sound should play for a new notification. */
export function shouldPlayNotificationSound(): boolean {
  const prefs = loadNotificationPrefs();
  if (!prefs.enabled || !prefs.soundEnabled) return false;
  if (prefs.soundId === 'none') return false;
  if (typeof document === 'undefined') return false;
  if (document.visibilityState !== 'visible') return false;
  return !document.hasFocus();
}

/** Play the selected notification sound (respects prefs). */
export function playNotificationSound(forceSoundId?: string): void {
  const prefs = loadNotificationPrefs();
  const soundId = forceSoundId ?? prefs.soundId;
  if (soundId === 'none') return;
  const sound = getNotificationSound(soundId);
  if (!sound?.url) return;

  try {
    const audio = new Audio(sound.url);
    audio.volume = 0.65;
    void audio.play().catch(() => {
      /* autoplay blocked */
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
    if (!previewAudio) {
      previewAudio = new Audio();
    }
    previewAudio.src = sound.url;
    previewAudio.volume = 0.75;
    void previewAudio.play().catch(() => {
      /* user may need another gesture */
    });
  } catch {
    /* no audio support */
  }
}
