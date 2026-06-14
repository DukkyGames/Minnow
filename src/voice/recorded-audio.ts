/**
 * Convert browser MediaRecorder blobs (WebM/Opus) to WAV for local STT.
 * The Python voice worker uses soundfile, which cannot decode WebM.
 */

const TARGET_SAMPLE_RATE = 16_000;

/** Mix multi-channel audio down to mono float samples. */
function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  const length = buffer.length;
  const out = new Float32Array(length);
  const channels = buffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      out[i] += data[i] / channels;
    }
  }
  return out;
}

/** Resample decoded audio to 16 kHz mono for Whisper. */
async function resampleMono(
  buffer: AudioBuffer,
  targetRate: number,
): Promise<Float32Array> {
  if (buffer.sampleRate === targetRate && buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  const mono = mixToMono(buffer);
  if (buffer.sampleRate === targetRate) {
    return mono;
  }
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(buffer.duration * targetRate),
    targetRate,
  );
  const monoBuffer = offline.createBuffer(1, mono.length, buffer.sampleRate);
  monoBuffer.copyToChannel(new Float32Array(mono), 0);
  const source = offline.createBufferSource();
  source.buffer = monoBuffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Encode mono float PCM as 16-bit little-endian WAV. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Decode a browser recording and return 16 kHz mono WAV suitable for STT upload.
 */
export async function recordedBlobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const mono = await resampleMono(decoded, TARGET_SAMPLE_RATE);
    return encodeWav(mono, TARGET_SAMPLE_RATE);
  } finally {
    await audioContext.close();
  }
}
