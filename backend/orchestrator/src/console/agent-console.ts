import type { Express, NextFunction, Request, Response } from 'express';
import type { SupportTask, TaskEvent } from '@holdless/db';
import type { TaskArtifacts } from '../tasks/manager';

export interface ConsoleDeps {
  requestTask(args: { channel: string; provider: string; query: string; paramsJson: string }): Promise<void>;
  approveTask(taskId: bigint): Promise<void>;
  cancelTask(taskId: bigint): Promise<void>;
  tasks(): SupportTask[];
  events(taskId: bigint): TaskEvent[];
  artifacts(taskId: bigint): TaskArtifacts | undefined;
}

/**
 * This machine only. Requests through a tunnel (cloudflared/ngrok add forwarding
 * headers and a public Host) and requests from other websites are refused: writes
 * need a custom header, which browsers won't send cross-origin without a CORS
 * preflight we never approve.
 */
function localOnly(req: Request, res: Response, next: NextFunction) {
  const local = ['localhost', '127.0.0.1', '::1'].includes(req.hostname);
  const proxied = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-host'];
  if (!local || proxied) return res.status(403).send('The agent console is only available on this computer.');
  if (req.method !== 'GET' && req.header('x-holdless') !== '1') return res.status(403).send('Missing x-holdless header');
  next();
}

const ms = (ts: { microsSinceUnixEpoch: bigint } | undefined) => (ts ? Number(ts.microsSinceUnixEpoch / 1000n) : null);

export function mountAgentConsole(app: Express, deps: ConsoleDeps) {
  app.use('/agent', localOnly);

  app.get('/agent', (_req, res) => res.type('html').send(PAGE));

  app.get('/agent/state', (_req, res) => {
    const tasks = deps
      .tasks()
      .filter((t) => t.channel === 'browser')
      .sort((a, b) => Number(b.id - a.id))
      .slice(0, 6)
      .map((t) => {
        const art = deps.artifacts(t.id);
        return {
          id: t.id.toString(),
          provider: t.provider,
          query: t.query,
          status: t.status,
          step: t.step,
          summary: t.summary,
          result: t.result,
          errorMessage: t.errorMessage,
          approveRequested: t.approveRequested,
          createdAt: ms(t.createdAt),
          hasScreen: !!art?.screen,
          hasQr: !!art?.qr,
          events: deps
            .events(t.id)
            .sort((a, b) => (ms(a.timestamp) ?? 0) - (ms(b.timestamp) ?? 0) || Number(a.id - b.id))
            .map((e) => ({ at: ms(e.timestamp), kind: e.kind, title: e.title, description: e.description })),
        };
      });
    res.json({ tasks });
  });

  app.post('/agent/tasks', async (req, res) => {
    const item = String(req.body?.item ?? '').trim();
    const reason = String(req.body?.reason ?? '').trim();
    const orderNumber = String(req.body?.orderNumber ?? '').trim();
    if (!item || item.length > 200) return res.status(400).json({ error: 'Say what to return (max 200 characters).' });
    if (!reason || reason.length > 250) return res.status(400).json({ error: 'Say why you are returning it (max 250 characters).' });
    try {
      await deps.requestTask({
        channel: 'browser',
        provider: 'Amazon',
        query: `Return ${item} — ${reason}`,
        paramsJson: JSON.stringify({ item, reason, orderNumber: orderNumber || undefined, autoConfirm: req.body?.autoConfirm === true }),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  const withId = (fn: (id: bigint) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(BigInt(String(req.params.id)));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  };
  app.post('/agent/tasks/:id/approve', withId(deps.approveTask));
  app.post('/agent/tasks/:id/cancel', withId(deps.cancelTask));

  app.get('/agent/tasks/:id/:kind.png', (req, res) => {
    let id: bigint;
    try {
      id = BigInt(String(req.params.id));
    } catch {
      return res.sendStatus(400);
    }
    const art = deps.artifacts(id);
    const png = req.params.kind === 'qr' ? art?.qr : req.params.kind === 'confirmation' ? art?.confirmation : art?.screen;
    if (!png) return res.sendStatus(404);
    res.set('cache-control', 'no-store').type('png').send(png);
  });
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HoldLess · Browser agent</title>
<style>
  :root{--bg:#f7f6f2;--card:#fffefb;--ink:#24211d;--muted:#6b665f;--line:#e4e1da;--ai:#2f5fd0;--ok:#16794a;--warn:#a86b00;--bad:#b3261e}
  @media (prefers-color-scheme:dark){:root{--bg:#1b1916;--card:#23211d;--ink:#f2f0ea;--muted:#a8a39a;--line:#3a3631;--ai:#8fb0ff;--ok:#5fd39a;--warn:#f0c060;--bad:#ff8a80}}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}
  main{max-width:1100px;margin:0 auto;padding:24px 16px 60px;display:grid;gap:20px;grid-template-columns:minmax(0,380px) minmax(0,1fr)}
  @media (max-width:860px){main{grid-template-columns:1fr}}
  h1{font-size:22px;margin:0 0 4px;letter-spacing:-.02em} h2{font-size:16px;margin:0 0 12px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  label{display:block;font-size:13px;color:var(--muted);margin:12px 0 4px}
  input[type=text],textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
  .check{display:flex;gap:8px;align-items:flex-start;color:var(--ink);font-size:14px;margin-top:14px}
  button{font:inherit;border:0;border-radius:10px;padding:11px 16px;cursor:pointer;font-weight:600}
  .primary{background:var(--ink);color:var(--bg);width:100%;margin-top:16px} .primary:disabled{opacity:.5;cursor:default}
  .approve{background:var(--ok);color:#fff} .ghost{background:transparent;border:1px solid var(--line);color:var(--muted)}
  .muted{color:var(--muted);font-size:13px} .err{color:var(--bad);font-size:14px;margin-top:10px}
  .pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:99px;border:1px solid var(--line)}
  .s-RUNNING,.s-REQUESTED{color:var(--ai)} .s-WAITING_FOR_USER{color:var(--warn)} .s-COMPLETED{color:var(--ok)} .s-FAILED,.s-CANCELLED{color:var(--bad)}
  .ask{border:1px solid var(--warn);border-radius:10px;padding:12px;margin:12px 0;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
  ol{list-style:none;padding:0;margin:12px 0 0} li{padding:7px 0;border-top:1px solid var(--line);font-size:14px}
  li time{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);margin-right:8px}
  .k-wait{color:var(--warn)} .k-success{color:var(--ok)} .k-error{color:var(--bad)}
  img.screen{width:100%;border:1px solid var(--line);border-radius:10px;margin-top:12px}
  .result{white-space:pre-wrap;background:var(--bg);border-radius:8px;padding:10px;margin-top:10px;font-size:14px}
</style></head><body><main>
<section class="card">
  <h1>Return something on Amazon</h1>
  <p class="muted">HoldLess opens its own Chrome window and does the return for you. You sign in there yourself the first time; your password never touches HoldLess.</p>
  <form id="f">
    <label for="item">What are you returning?</label>
    <input id="item" type="text" required maxlength="200" placeholder="Logitech wireless mouse"/>
    <label for="reason">Why?</label>
    <input id="reason" type="text" required maxlength="250" placeholder="The scroll wheel is broken"/>
    <label for="order">Order number (optional)</label>
    <input id="order" type="text" maxlength="40" placeholder="112-1234567-1234567"/>
    <label class="check"><input id="auto" type="checkbox"/> <span>Let HoldLess click the final <b>Confirm your return</b> itself. If unchecked, it asks you first.</span></label>
    <button class="primary" id="go" type="submit">Start Amazon return</button>
    <div class="err" id="err"></div>
  </form>
  <p class="muted" style="margin-top:14px">Refunds go to your original payment method; HoldLess never clicks buy, gift-card, replacement or payment controls.</p>
</section>
<section class="card" id="task"><h2>Agent</h2><p class="muted">No return running yet.</p></section>
</main>
<script>
const H={'content-type':'application/json','x-holdless':'1'};
const $=(id)=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);kids.forEach(k=>e.append(k));return e;};
const fmt=(t)=>t?new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}):'';
let current=null, busy=false;
$('f').onsubmit=async(e)=>{e.preventDefault();$('err').textContent='';$('go').disabled=true;busy=true;
  const r=await fetch('/agent/tasks',{method:'POST',headers:H,body:JSON.stringify({item:$('item').value,reason:$('reason').value,orderNumber:$('order').value,autoConfirm:$('auto').checked})});
  if(!r.ok){$('err').textContent=(await r.json().catch(()=>({}))).error||'Could not start';$('go').disabled=false;}
  busy=false; poll();};
async function act(id,what){await fetch('/agent/tasks/'+id+'/'+what,{method:'POST',headers:H});poll();}
function render(t){
  const box=$('task'); box.replaceChildren(el('h2',{},'Agent'));
  if(!t){box.append(el('p',{className:'muted'},'No return running yet.'));return;}
  box.append(el('div',{},el('span',{className:'pill s-'+t.status},t.status.replace(/_/g,' ')),' ',el('b',{},t.step)));
  box.append(el('p',{},t.summary||''));
  if(t.status==='WAITING_FOR_USER'){const ask=el('div',{className:'ask'},el('span',{},t.step==='Ready to submit'?'Approve submitting the return?':'Your turn in the Chrome window'));
    if(t.step==='Ready to submit'&&!t.approveRequested)ask.append(el('button',{className:'approve',onclick:()=>act(t.id,'approve')},'Approve & submit'));
    box.append(ask);}
  if(!['COMPLETED','FAILED','CANCELLED'].includes(t.status))box.append(el('button',{className:'ghost',onclick:()=>act(t.id,'cancel')},'Cancel'));
  if(t.result)box.append(el('div',{className:'result'},t.result));
  if(t.hasQr)box.append(el('img',{className:'screen',src:'/agent/tasks/'+t.id+'/qr.png?'+Date.now(),alt:'Return QR code',style:'max-width:220px'}));
  if(t.hasScreen)box.append(el('img',{className:'screen',src:'/agent/tasks/'+t.id+'/screen.png?'+Date.now(),alt:'What the agent sees'}));
  const ol=el('ol');t.events.slice().reverse().forEach(e=>ol.append(el('li',{className:'k-'+e.kind},el('time',{},fmt(e.at)),e.title,e.description?el('div',{className:'muted'},e.description):'')));
  box.append(ol);
}
async function poll(){try{const r=await fetch('/agent/state');const {tasks}=await r.json();current=tasks[0]||null;render(current);
  const live=current&&!['COMPLETED','FAILED','CANCELLED'].includes(current.status);if(!busy)$('go').disabled=!!live;}catch{}}
poll();setInterval(poll,1500);
</script></body></html>`;
