// Dev helper: `npx tsx test/fixtures/serve-mock-amazon.ts [port]` serves the Amazon stand-in.
// POST /_test/login simulates you signing in; GET /_test/state shows what the agent chose.
import express from 'express';
import { startMockAmazon } from './mock-amazon';

const mock = await startMockAmazon();
const port = Number(process.argv[2] ?? 4555);
const app = express();
app.post('/_test/login', (_req, res) => {
  mock.state.signedIn = true;
  res.send('ok');
});
app.get('/_test/state', (_req, res) => res.json(mock.state));
app.use(async (req, res) => {
  const r = await fetch(mock.baseUrl + req.originalUrl, {
    method: req.method,
    headers: { 'content-type': req.headers['content-type'] ?? '' },
    body: ['GET', 'HEAD'].includes(req.method)
      ? undefined
      : await new Promise<string>((ok) => {
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(c)).on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
        }),
    redirect: 'manual',
  });
  res.status(r.status);
  const loc = r.headers.get('location');
  if (loc) res.set('location', loc);
  res.set('content-type', r.headers.get('content-type') ?? 'text/html').send(Buffer.from(await r.arrayBuffer()));
});
app.listen(port, () => console.log(`mock amazon on http://127.0.0.1:${port}`));
