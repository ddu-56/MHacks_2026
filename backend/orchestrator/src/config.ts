import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: path.join(root, '.env'), quiet: true });

const env = (key: string, fallback = '') => process.env[key]?.trim() || fallback;
const num = (key: string, fallback: number) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && process.env[key] !== '' ? v : fallback;
};
const bool = (key: string, fallback: boolean) => {
  const v = process.env[key]?.toLowerCase();
  return v === undefined || v === '' ? fallback : v === 'true' || v === '1';
};

const demoMode = bool('DEMO_MODE', true);

export const config = {
  rootDir: root,
  dataDir: path.join(root, 'backend/orchestrator/.data'),
  port: num('ORCHESTRATOR_PORT', 4000),
  publicBaseUrl: env('PUBLIC_BASE_URL').replace(/\/$/, ''),

  spacetime: {
    host: env('SPACETIMEDB_HOST', env('NEXT_PUBLIC_SPACETIMEDB_HOST', 'ws://127.0.0.1:3000')),
    module: env('SPACETIMEDB_MODULE', env('NEXT_PUBLIC_SPACETIMEDB_MODULE', 'holdless')),
  },

  telephonyMode: (['twilio', 'hybrid'].includes(env('TELEPHONY_MODE')) ? env('TELEPHONY_MODE') : 'mock') as
    | 'mock'
    | 'hybrid'
    | 'twilio',
  demoMode,

  twilio: {
    accountSid: env('TWILIO_ACCOUNT_SID'),
    authToken: env('TWILIO_AUTH_TOKEN'),
    phoneNumber: env('TWILIO_PHONE_NUMBER'),
    validateSignatures: bool('TWILIO_VALIDATE_SIGNATURES', false),
  },

  demo: {
    wolverineNumber: env('WOLVERINE_IVR_NUMBER'),
    repPhoneNumber: env('DEMO_REP_PHONE_NUMBER'),
    userPhoneNumber: env('USER_PHONE_NUMBER'),
    holdSeconds: num('DEMO_HOLD_SECONDS', demoMode ? 12 : 45),
    holdAnnouncementSeconds: num('DEMO_HOLD_ANNOUNCEMENT_SECONDS', demoMode ? 6 : 20),
  },

  gemini: {
    apiKey: env('GEMINI_API_KEY'),
    model: env('GEMINI_MODEL'),
    timeoutMs: num('GEMINI_TIMEOUT_MS', 8000),
  },

  elevenlabs: {
    apiKey: env('ELEVENLABS_API_KEY'),
    voiceId: env('ELEVENLABS_VOICE_ID', 'JBFqnCBsd6RMkjVDRZzb'),
    ttsModel: env('ELEVENLABS_TTS_MODEL', 'eleven_flash_v2_5'),
    sttModel: env('ELEVENLABS_STT_MODEL', 'scribe_v2_realtime'),
  },

  photon: {
    projectId: env('PHOTON_PROJECT_ID'),
    projectSecret: env('PHOTON_PROJECT_SECRET'),
  },
  webBaseUrl: env('WEB_BASE_URL', 'http://localhost:3001').replace(/\/$/, ''),

  agent: {
    humanThreshold: num('HUMAN_CONFIDENCE_THRESHOLD', 0.8),
    possibleHumanThreshold: num('POSSIBLE_HUMAN_THRESHOLD', 0.5),
    utteranceGapMs: num('UTTERANCE_GAP_MS', demoMode ? 1100 : 1500),
    maxKeyPresses: num('MAX_KEY_PRESSES', 12),
    maxHoldMinutes: num('MAX_HOLD_MINUTES', demoMode ? 5 : 90),
    userAnswerTimeoutSeconds: num('USER_ANSWER_TIMEOUT_SECONDS', 30),
  },
};

export type Config = typeof config;
