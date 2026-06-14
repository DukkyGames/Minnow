/**
 * Composer microphone button — MediaRecorder dictation into the active textarea.
 */

import { getActiveComposerSurface } from './composer-surface';
import { autoResize } from './input';
import { setStatus } from './status';
import { openModels } from './models-page';
import { loadVoiceMeta } from '../config/voice-meta';
import { fetchSttStatus } from './voice-controls';

type MicState = 'idle' | 'recording' | 'transcribing';

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: BlobPart[] = [];
let recordingStream: MediaStream | null = null;
let micState: MicState = 'idle';
let recordingTimer: ReturnType<typeof setInterval> | null = null;
let recordingStartedAt = 0;
let maxDurationSeconds = 300;
let inputDeviceId = '';

const MIC_BUTTON_IDS = ['btnComposerMic', 'btnChatAppMic'] as const;

/** Insert transcribed text at the caret in a textarea. */
function insertTranscript(input: HTMLTextAreaElement, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const spacer =
    before && !before.endsWith(' ') && !trimmed.startsWith(' ')
      ? ' '
      : '';
  input.value = `${before}${spacer}${trimmed}${after}`;
  const caret = before.length + spacer.length + trimmed.length;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  autoResize(input);
  input.focus();
}

function setMicButtonsState(state: MicState): void {
  micState = state;
  for (const id of MIC_BUTTON_IDS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.classList.toggle('composer-mic-btn--recording', state === 'recording');
    btn.classList.toggle('composer-mic-btn--busy', state === 'transcribing');
    btn.setAttribute(
      'aria-label',
      state === 'recording'
        ? 'Stop recording'
        : state === 'transcribing'
          ? 'Transcribing'
          : 'Dictate with microphone',
    );
  }
}

function clearRecordingTimer(): void {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
}

function stopMediaTracks(): void {
  if (recordingStream) {
    for (const track of recordingStream.getTracks()) {
      track.stop();
    }
    recordingStream = null;
  }
}

async function transcribeBlob(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('file', blob, 'audio.webm');
  const res = await fetch('/api/stt/transcribe', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      typeof err.error === 'string' ? err.error : 'Transcription failed';
    throw new Error(message);
  }
  const data = (await res.json()) as { text?: string };
  return typeof data.text === 'string' ? data.text.trim() : '';
}

async function handleRecordingStop(): Promise<void> {
  stopMediaTracks();
  clearRecordingTimer();
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  audioChunks = [];
  mediaRecorder = null;

  if (!blob.size) {
    setMicButtonsState('idle');
    setStatus('err', 'No audio captured');
    return;
  }

  setMicButtonsState('transcribing');
  setStatus('spin', 'Transcribing…');
  try {
    const text = await transcribeBlob(blob);
    const { inputEl } = getActiveComposerSurface();
    if (text) {
      insertTranscript(inputEl, text);
      setStatus('ok', 'Transcribed');
    } else {
      setStatus('err', 'No speech detected');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription failed';
    setStatus('err', message);
    if (message.includes('Settings') || message.includes('provider') || message.includes('Models')) {
      openModels('voice');
    }
  } finally {
    setMicButtonsState('idle');
  }
}

async function startRecording(): Promise<void> {
  if (micState !== 'idle') return;

  if (!window.isSecureContext) {
    setStatus('err', 'Microphone requires HTTPS or localhost');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('err', 'Microphone is not supported in this browser');
    return;
  }

  const status = await fetchSttStatus();
  if (!status?.enabled) {
    setStatus('err', 'Speech-to-text is disabled. Open Models → Voice.');
    openModels('voice');
    return;
  }
  if (!status.healthy) {
    setStatus('err', 'STT provider is not configured. Open Models → Voice.');
    openModels('voice');
    return;
  }

  try {
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (inputDeviceId) {
      audioConstraints.deviceId = { exact: inputDeviceId };
    }
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
    audioChunks = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      void handleRecordingStop();
    };
    mediaRecorder.onerror = () => {
      setMicButtonsState('idle');
      stopMediaTracks();
      setStatus('err', 'Recording failed');
    };
    mediaRecorder.start();
    recordingStartedAt = Date.now();
    setMicButtonsState('recording');
    setStatus('ok', 'Recording… click mic to stop');

    clearRecordingTimer();
    recordingTimer = setInterval(() => {
      const elapsed = (Date.now() - recordingStartedAt) / 1000;
      if (elapsed >= maxDurationSeconds) {
        stopRecording();
        setStatus('err', `Recording stopped at ${maxDurationSeconds}s limit`);
      }
    }, 500);
  } catch (err) {
    stopMediaTracks();
    setMicButtonsState('idle');
    const error = err as DOMException;
    if (error?.name === 'NotAllowedError') {
      setStatus('err', 'Microphone access denied');
      return;
    }
    if (error?.name === 'NotFoundError') {
      setStatus('err', 'No microphone found');
      return;
    }
    setStatus('err', 'Could not access microphone');
  }
}

/** Stop an active recording if one is in progress. */
export function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  setMicButtonsState('idle');
  stopMediaTracks();
  clearRecordingTimer();
}

function onMicClick(): void {
  if (micState === 'recording') {
    stopRecording();
    return;
  }
  if (micState === 'transcribing') return;
  void startRecording();
}

function ensureMicButton(id: string, anchorId: string): void {
  if (document.getElementById(id)) return;
  const anchor = document.getElementById(anchorId);
  if (!anchor?.parentElement) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'attach-btn composer-mic-btn';
  btn.setAttribute('aria-label', 'Dictate with microphone');
  btn.title = 'Dictate';
  btn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M19 11a7 7 0 0 1-14 0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 18v3"/></svg>';
  btn.addEventListener('click', onMicClick);
  anchor.insertAdjacentElement('afterend', btn);
}

/** Mount mic buttons on Code and Chat composer surfaces. */
export function initComposerVoice(): void {
  ensureMicButton('btnComposerMic', 'attachBtn');
  ensureMicButton('btnChatAppMic', 'btnChatAppAttach');

  void (async () => {
    try {
      const voiceMeta = await loadVoiceMeta();
      inputDeviceId = voiceMeta.audio.inputDeviceId ?? '';
      const seconds = voiceMeta.limits?.maxDurationSeconds;
      if (typeof seconds === 'number' && Number.isFinite(seconds)) {
        maxDurationSeconds = Math.max(1, Math.round(seconds));
      }
    } catch {
      /* keep defaults */
    }
    try {
      const res = await fetch('/api/config/meta', { cache: 'no-store' });
      if (!res.ok) return;
      const meta = (await res.json()) as {
        voice?: { limits?: { maxDurationSeconds?: number } };
      };
      const seconds = meta.voice?.limits?.maxDurationSeconds;
      if (typeof seconds === 'number' && Number.isFinite(seconds)) {
        maxDurationSeconds = Math.max(1, Math.round(seconds));
      }
    } catch {
      /* keep default */
    }
  })();
}

export function getMicState(): MicState {
  return micState;
}
