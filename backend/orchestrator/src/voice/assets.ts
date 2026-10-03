import crypto from 'node:crypto';
import { config } from '../config';
import { synthesize } from './elevenlabs';

const assets = new Map<string, { body: Buffer; type: string }>();

export function putAsset(body: Buffer, type: string, ext: string): string {
  const key = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
  assets.set(key, { body, type });
  if (assets.size > 200) assets.delete(assets.keys().next().value!);
  return `${config.publicBaseUrl}/audio/${key}`;
}

export function getAsset(key: string) {
  return assets.get(key);
}

/** ElevenLabs speech as a playable URL, or null to fall back to <Say>. */
export async function speechUrl(text: string): Promise<string | null> {
  const mp3 = await synthesize(text);
  return mp3 ? putAsset(mp3, 'audio/mpeg', 'mp3') : null;
}
