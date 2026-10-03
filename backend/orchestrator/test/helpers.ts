import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';

/** Minimal stand-in for the Twilio REST client: records creates/updates, returns fake SIDs. */
export function fakeTwilio(opts: { failTo?: Record<string, number> } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<{ sid: string; args: Record<string, unknown> }> = [];
  let n = 0;
  const callCtx = (sid: string) => ({
    update: async (args: Record<string, unknown>) => void updates.push({ sid, args }),
    fetch: async () => ({ status: 'in-progress' }),
    streams: Object.assign(() => ({ update: async () => {} }), { create: async () => ({}) }),
    transcriptions: Object.assign(() => ({ update: async () => {} }), { create: async () => ({}) }),
  });
  const calls = Object.assign(callCtx, {
    create: async (args: Record<string, unknown>) => {
      const code = opts.failTo?.[String(args.to)];
      if (code) throw Object.assign(new Error(`Twilio error ${code}`), { code });
      created.push(args);
      return { sid: `CA${++n}` };
    },
  });
  return { client: { calls } as never, created, updates };
}

export async function serve(mount: (app: Express) => void) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  mount(app);
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      body: new URLSearchParams(body),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  return { server, post };
}

export async function until(pred: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
