import { WebSocket } from 'ws';
import { config } from '../config';
import { log } from '../log';

export interface SttSession {
  /** Feed one base64 μ-law 8 kHz chunk exactly as Twilio delivers it. */
  sendUlaw(base64: string): void;
  close(): void;
}

export interface SttHandlers {
  onText(text: string): void;
  onError(message: string): void;
}

const STT_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const BATCH_CHUNKS = 5; // Twilio sends 20 ms frames; forward 100 ms at a time.

/** Drops non-speech annotations like "(music)" or "[upbeat music]". */
export function cleanTranscript(text: string): string {
  return text
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ElevenLabs Scribe realtime STT over the phone line. Twilio's μ-law audio is
 * passed through untouched (Scribe accepts ulaw_8000), and Scribe's VAD commits
 * each utterance, which the call runner then debounces into full prompts.
 */
export function openElevenLabsStt(handlers: SttHandlers): SttSession {
  const params = new URLSearchParams({
    model_id: config.elevenlabs.sttModel,
    audio_format: 'ulaw_8000',
    commit_strategy: 'vad',
    vad_silence_threshold_secs: '0.7',
    language_code: 'en',
  });
  const ws = new WebSocket(`${STT_URL}?${params}`, { headers: { 'xi-api-key': config.elevenlabs.apiKey } });
  let pending: Buffer[] = [];
  let closed = false;

  ws.on('message', (raw) => {
    let msg: { message_type?: string; text?: string; error?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.message_type === 'committed_transcript' && msg.text) {
      const text = cleanTranscript(msg.text);
      if (text) handlers.onText(text);
    } else if (msg.message_type && /error|exceeded|rate_limited/.test(msg.message_type) && msg.message_type !== 'insufficient_audio_activity') {
      handlers.onError(`${msg.message_type}: ${msg.error ?? ''}`);
    }
  });
  ws.on('error', (err) => handlers.onError(err.message));
  ws.on('close', (code) => {
    if (!closed) log.warn(`ElevenLabs STT socket closed (${code})`);
  });

  const flush = () => {
    if (!pending.length || ws.readyState !== WebSocket.OPEN) return;
    const audio = Buffer.concat(pending).toString('base64');
    pending = [];
    ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: audio, commit: false, sample_rate: 8000 }));
  };

  return {
    sendUlaw(base64) {
      if (closed) return;
      pending.push(Buffer.from(base64, 'base64'));
      if (pending.length >= BATCH_CHUNKS) flush();
    },
    close() {
      closed = true;
      flush();
      ws.close();
    },
  };
}

/** ElevenLabs TTS → MP3 bytes, or null if unavailable (callers fall back to Twilio <Say>). */
export async function synthesize(text: string): Promise<Buffer | null> {
  if (!config.elevenlabs.apiKey) return null;
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabs.voiceId}?output_format=mp3_22050_32`,
      {
        method: 'POST',
        headers: { 'xi-api-key': config.elevenlabs.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: config.elevenlabs.ttsModel }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    log.warn(`ElevenLabs TTS failed (${(err as Error).message}); falling back to Twilio <Say>`);
    return null;
  }
}
