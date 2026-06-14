/**
 * Voice playback helpers for assistant messages and shared TTS/STT API calls.
 */

import { setStatus } from './status';
import { openSettings } from './settings-page';

export interface SttStatus {
  enabled: boolean;
  providerId: string;
  model: string;
  language: string;
  healthy: boolean;
}

export interface TtsStatus {
  enabled: boolean;
  providerId: string;
  model: string;
  voice: string;
  speed: number;
  format: string;
  browser: boolean;
  healthy: boolean;
}

let cachedSttStatus: SttStatus | null = null;
let cachedTtsStatus: TtsStatus | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentPlayButton: HTMLButtonElement | null = null;

/** Fetch STT availability from the tool server. */
export async function fetchSttStatus(): Promise<SttStatus | null> {
  try {
    const res = await fetch('/api/stt/status', { cache: 'no-store' });
    if (!res.ok) return null;
    const status = (await res.json()) as SttStatus;
    cachedSttStatus = status;
    return status;
  } catch {
    return null;
  }
}

/** Fetch TTS availability from the tool server. */
export async function fetchTtsStatus(): Promise<TtsStatus | null> {
  try {
    const res = await fetch('/api/tts/status', { cache: 'no-store' });
    if (!res.ok) return null;
    const status = (await res.json()) as TtsStatus;
    cachedTtsStatus = status;
    return status;
  } catch {
    return null;
  }
}

export function getCachedTtsStatus(): TtsStatus | null {
  return cachedTtsStatus;
}

export function getCachedSttStatus(): SttStatus | null {
  return cachedSttStatus;
}

/** Strip markdown-ish content to plain speech text. */
export function extractSpeechText(content: string): string {
  let cleaned = content.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ' ');
  cleaned = cleaned.replace(/`[^`]+`/g, ' ');
  cleaned = cleaned.replace(/!\[[^\]]*]\([^)]+\)/g, ' ');
  cleaned = cleaned.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
  cleaned = cleaned.replace(/[#>*_~\-]+/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function stopCurrentPlayback(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentPlayButton) {
    currentPlayButton.classList.remove('voice-play-btn--loading');
    currentPlayButton.setAttribute('aria-label', 'Read aloud');
    currentPlayButton = null;
  }
}

/** Play text with browser speechSynthesis fallback. */
export function speakWithBrowser(text: string, voiceName = '', rate = 1): void {
  if (!('speechSynthesis' in window)) {
    setStatus('err', 'Browser speech is not supported here');
    return;
  }
  stopCurrentPlayback();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = Math.min(4, Math.max(0.25, rate));
  if (voiceName) {
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.name === voiceName || v.voiceURI === voiceName);
    if (match) utterance.voice = match;
  }
  utterance.onend = () => setStatus('ok', 'Finished reading');
  utterance.onerror = () => setStatus('err', 'Browser speech failed');
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  setStatus('ok', 'Reading aloud…');
}

/** Request synthesized audio bytes from the server. */
export async function synthesizeSpeech(
  text: string,
  options?: { voice?: string; speed?: number; format?: string },
): Promise<Blob> {
  const res = await fetch('/api/tts/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: options?.voice,
      speed: options?.speed,
      format: options?.format,
      returnBytes: true,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      typeof err.error === 'string' ? err.error : 'Speech synthesis failed';
    throw new Error(message);
  }
  return res.blob();
}

/** Play assistant message text via configured TTS (never autoplay). */
export async function playAssistantText(
  text: string,
  button?: HTMLButtonElement,
): Promise<void> {
  const plain = extractSpeechText(text);
  if (!plain) {
    setStatus('err', 'Nothing to read aloud');
    return;
  }

  const status = cachedTtsStatus ?? (await fetchTtsStatus());
  if (!status?.enabled) {
    setStatus('err', 'Text-to-speech is disabled. Open Settings → Voice.');
    return;
  }

  if (button) {
    stopCurrentPlayback();
    currentPlayButton = button;
    button.classList.add('voice-play-btn--loading');
    button.setAttribute('aria-label', 'Loading speech');
  }

  try {
    if (status.browser || status.providerId === 'browser') {
      speakWithBrowser(plain, status.voice, status.speed);
      return;
    }
    if (!status.healthy) {
      setStatus('err', 'TTS provider is not configured. Open Settings → Voice.');
      openSettings('voice');
      return;
    }

    const blob = await synthesizeSpeech(plain, {
      voice: status.voice,
      speed: status.speed,
      format: status.format,
    });
    stopCurrentPlayback();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    if (button) currentPlayButton = button;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      stopCurrentPlayback();
      setStatus('ok', 'Finished reading');
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      stopCurrentPlayback();
      setStatus('err', 'Could not play audio');
    };
    await audio.play();
    setStatus('ok', 'Reading aloud…');
  } catch (err) {
    stopCurrentPlayback();
    const message = err instanceof Error ? err.message : 'Speech failed';
    setStatus('err', message);
    if (message.includes('Settings')) {
      openSettings('voice');
    }
  }
}

/** Attach a read-aloud button to a completed assistant message row. */
export function attachVoicePlayButton(wrap: HTMLElement, text: string): void {
  if (wrap.dataset.streaming === 'true') return;
  if (wrap.querySelector('.voice-play-btn')) return;
  const plain = extractSpeechText(text);
  if (!plain) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'voice-play-btn message-actions__trigger';
  btn.setAttribute('aria-label', 'Read aloud');
  btn.title = 'Read aloud';
  btn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    void playAssistantText(text, btn);
  });

  wrap.classList.add('msg--has-actions');
  wrap.append(btn);
}

/** Prime voice status caches on boot. */
export async function initVoiceStatus(): Promise<void> {
  await Promise.all([fetchSttStatus(), fetchTtsStatus()]);
}
