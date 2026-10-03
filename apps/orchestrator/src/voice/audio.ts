/** G.711 μ-law byte → 16-bit linear sample. */
function ulawToLinear(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign ? -sample : sample;
}

export function ulawRms(chunk: Buffer): number {
  if (chunk.length === 0) return 0;
  let sum = 0;
  for (const b of chunk) {
    const s = ulawToLinear(b);
    sum += s * s;
  }
  return Math.sqrt(sum / chunk.length);
}

/**
 * Coarse hold-music detector: sustained audio energy with no recognized speech
 * reads as music; the energy dropping or speech resuming ends it.
 */
export class AudioClassifier {
  private activeSince = 0;
  private quietSince = 0;
  private lastSpeechAt = 0;
  private state: 'idle' | 'music' = 'idle';

  constructor(
    private readonly emit: (signal: 'music' | 'speech') => void,
    private readonly opts = { threshold: 500, musicAfterMs: 5000, quietToEndMs: 1200 },
  ) {}

  noteSpeech(now = Date.now()) {
    this.lastSpeechAt = now;
    if (this.state === 'music') {
      this.state = 'idle';
      this.emit('speech');
    }
  }

  feed(chunk: Buffer, now = Date.now()) {
    const active = ulawRms(chunk) > this.opts.threshold;
    if (active) {
      this.quietSince = 0;
      if (!this.activeSince) this.activeSince = now;
      const noSpeech = now - this.lastSpeechAt > this.opts.musicAfterMs;
      if (this.state === 'idle' && noSpeech && now - this.activeSince > this.opts.musicAfterMs) {
        this.state = 'music';
        this.emit('music');
      }
    } else {
      this.activeSince = 0;
      if (!this.quietSince) this.quietSince = now;
      if (this.state === 'music' && now - this.quietSince > this.opts.quietToEndMs) {
        this.state = 'idle';
        this.emit('speech');
      }
    }
  }
}

/** A short, gentle hold-music loop synthesized at startup (8 kHz WAV), so the demo IVR needs no external assets. */
export function holdMusicWav(seconds = 6): Buffer {
  const rate = 8000;
  const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23, 440.0, 587.33, 440.0, 349.23];
  const noteLen = seconds / notes.length;
  const n = Math.floor(rate * seconds);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const idx = Math.min(notes.length - 1, Math.floor(t / noteLen));
    const local = t - idx * noteLen;
    const env = Math.min(1, local * 30) * Math.exp(-local * 3.2);
    const f = notes[idx]!;
    const pad = 0.12 * Math.sin(2 * Math.PI * (notes[Math.floor(idx / 6) * 6]! / 2) * t);
    const v = env * (0.45 * Math.sin(2 * Math.PI * f * t) + 0.15 * Math.sin(4 * Math.PI * f * t)) + pad;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 9000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
