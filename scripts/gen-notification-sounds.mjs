
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'sounds', 'notifications');

function writeWavHeader(dataLength, sampleRate = 22050) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function makeToneSamples(frequency, durationSec, sampleRate, volume) {
  const sampleCount = Math.floor(sampleRate * durationSec);
  const data = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 6);
    const sample = Math.sin(2 * Math.PI * frequency * t) * volume * env;
    const int16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    data.writeInt16LE(int16, i * 2);
  }
  return data;
}

function makeToneWav(frequency, durationSec, volume = 0.3) {
  const sampleRate = 22050;
  const data = makeToneSamples(frequency, durationSec, sampleRate, volume);
  return Buffer.concat([writeWavHeader(data.length, sampleRate), data]);
}

function makeChimeWav() {
  const sampleRate = 22050;
  const partA = makeToneSamples(523.25, 0.18, sampleRate, 0.28);
  const partB = makeToneSamples(659.25, 0.22, sampleRate, 0.24);
  const data = Buffer.concat([partA, partB]);
  return Buffer.concat([writeWavHeader(data.length, sampleRate), data]);
}

const tones = {
  chime: makeChimeWav(),
  ping: makeToneWav(880, 0.12, 0.32),
  soft: makeToneWav(440, 0.28, 0.18),
  pop: makeToneWav(660, 0.08, 0.38),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, buf] of Object.entries(tones)) {
  writeFileSync(join(OUT_DIR, `${name}.wav`), buf);
  console.log(`Wrote ${name}.wav (${buf.length} bytes)`);
}
