import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import twilio from 'twilio';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { mountWolverineIvr } from './ivr/wolverine';
import { log } from './log';
import type { TelephonyProvider } from './telephony/types';
import { getAsset } from './voice/assets';
import { holdMusicWav } from './voice/audio';

const HOLD_MUSIC = holdMusicWav();

function verifyTwilio(req: Request, res: Response, next: NextFunction) {
  if (!config.twilio.validateSignatures) return next();
  const signature = req.header('x-twilio-signature') ?? '';
  const ok = twilio.validateRequest(config.twilio.authToken, signature, `${config.publicBaseUrl}${req.originalUrl}`, req.body ?? {});
  if (!ok) {
    log.warn(`rejected unsigned webhook ${req.originalUrl}`);
    return res.sendStatus(403);
  }
  next();
}

export function startHttpServer({ telephony, mount }: { telephony: TelephonyProvider; mount?: (app: express.Express) => void }) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, telephony: telephony.name, demoMode: config.demoMode });
  });
  app.get('/audio/hold-music.wav', (_req, res) => {
    res.type('audio/wav').send(HOLD_MUSIC);
  });
  app.get('/audio/:key', (req, res) => {
    const asset = getAsset(req.params.key);
    if (!asset) return res.sendStatus(404);
    res.type(asset.type).send(asset.body);
  });

  app.use(['/twilio', '/ivr'], verifyTwilio);
  mountWolverineIvr(app);
  telephony.mount?.(app);
  mount?.(app);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/twilio/media' });
  wss.on('connection', (ws) => {
    if (telephony.handleMediaSocket) telephony.handleMediaSocket(ws);
    else ws.close();
  });
  server.listen(config.port, () => log.info(`HTTP listening on :${config.port}${config.publicBaseUrl ? ` (public: ${config.publicBaseUrl})` : ''}`));
  return server;
}
