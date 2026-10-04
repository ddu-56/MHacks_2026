import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

/**
 * A small stand-in for Amazon's order history + return wizard, shaped like the
 * real thing where it matters to the agent: sign-in redirect, order cards with
 * decoys (an old "Return started" order, a non-returnable order), a styled
 * dropdown hiding the native <select>, visually hidden radios behind labels,
 * a gift-card / replacement decoy, and a final "Confirm your return" page.
 */
export async function startMockAmazon() {
  const state = {
    signedIn: false,
    order: '',
    item: '',
    reason: '',
    comment: '',
    resolution: '',
    dropoff: '',
    confirmed: false,
    forbiddenClicks: [] as string[],
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title>
<style>
  body{font-family:Arial;margin:24px} .card{border:1px solid #ccc;border-radius:8px;margin:12px 0;padding:12px}
  .a-button{display:inline-block;background:#ffd814;border-radius:20px;padding:8px 14px;cursor:pointer;border:0}
  input.hidden-radio{position:absolute;opacity:0;width:1px;height:1px}
  label.opt{display:block;border:1px solid #ddd;padding:10px;margin:6px 0;border-radius:6px;cursor:pointer}
  select.native{position:absolute;opacity:0;width:1px;height:1px}
  .a-dropdown-prompt{border:1px solid #aaa;padding:6px;display:inline-block;min-width:240px}
</style></head><body>${body}</body></html>`;

  const requireLogin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!state.signedIn) return res.redirect(`/ap/signin?return_to=${encodeURIComponent(req.originalUrl)}`);
    next();
  };

  app.get('/ap/signin', (req, res) => {
    // Auto-advances once the test "signs in" (stands in for you typing your password).
    const back = String(req.query.return_to ?? '/gp/css/order-history');
    res.send(
      page(
        'Amazon Sign-In',
        `<form name="signIn" method="post" action="/ap/signin"><input id="ap_email" type="email" name="email"/>
         <input id="ap_password" type="password"/><button>Sign in</button></form>
         <script>setInterval(async()=>{const r=await fetch('/_test/signed-in');if((await r.text())==='yes')location.href=${JSON.stringify(back)}},500)</script>`,
      ),
    );
  });
  app.get('/_test/signed-in', (_req, res) => res.send(state.signedIn ? 'yes' : 'no'));

  app.get('/gp/css/order-history', requireLogin, (_req, res) => {
    const card = (order: string, product: string, extra: string) => `<div class="order-card card">
      <div>ORDER PLACED September 2, 2026 · ORDER # ${order}</div><a href="/dp/x">${product}</a>
      <div>${extra}</div><a href="/gp/buy/again" class="a-button">Buy it again</a></div>`;
    res.send(
      page(
        'Your Orders',
        `<h1>Your Orders</h1>
        ${card('111-1111111-1111111', 'Anker 735 USB-C Charger (65W)', 'Return started on Sep 20 · <span>Return or replace items</span>')}
        ${card('112-9842000-0000000', 'Logitech M720 Triathlon Multi-Device Wireless Mouse', '<a class="a-button" href="/spr/returns/cart?orderId=112-9842000-0000000">Return or replace items</a>')}
        ${card('113-5555555-5555555', 'Gift card ($25)', 'This item is non-returnable.')}
        ${card('114-7777777-7777777', 'Kindle Paperwhite', '<a class="a-button" href="/spr/returns/cart?orderId=114-7777777-7777777">Return or replace items</a>')}`,
      ),
    );
  });

  app.get('/spr/returns/cart', requireLogin, (req, res) => {
    state.order = String(req.query.orderId ?? '');
    const isMouse = state.order.startsWith('112');
    res.send(
      page(
        'Choose items to return',
        `<h1>Choose items to return</h1><form method="post" action="/spr/returns/cart">
        <label><input type="checkbox" name="item" value="${isMouse ? 'mouse' : 'kindle'}"/> ${isMouse ? 'Logitech M720 Triathlon Multi-Device Wireless Mouse' : 'Kindle Paperwhite'}</label>
        <p>Why are you returning this?</p>
        <span class="a-dropdown"><select class="native" name="reason">
          <option value="">Choose a response</option><option>Bought by mistake</option><option>Better price available</option>
          <option>No longer needed</option><option>Item defective or doesn't work</option><option>Wrong item was sent</option>
        </select><span class="a-dropdown-prompt">Choose a response</span></span>
        <p>Comments (optional)</p><textarea name="comment"></textarea>
        <div><button class="a-button" type="submit">Continue</button></div></form>`,
      ),
    );
  });
  app.post('/spr/returns/cart', requireLogin, (req, res) => {
    state.item = String(req.body.item ?? '');
    state.reason = String(req.body.reason ?? '');
    state.comment = String(req.body.comment ?? '');
    if (!state.item || !state.reason) return res.redirect(`/spr/returns/cart?orderId=${state.order}&error=1`);
    res.redirect('/spr/returns/resolution');
  });

  app.get('/spr/returns/resolution', requireLogin, (_req, res) => {
    const opt = (v: string, label: string) => `<label class="opt"><input class="hidden-radio" type="radio" name="resolution" value="${v}"/> ${label}</label>`;
    res.send(
      page(
        'How can we make it right?',
        `<h1>How can we make it right?</h1><form method="post" action="/spr/returns/resolution">
        ${opt('replacement', 'Replacement — get a new one shipped')}
        ${opt('giftcard', 'Refund as Amazon gift card balance — fastest')}
        ${opt('original', 'Refund to your original payment method (Visa ending in 1234)')}
        <button class="a-button" type="submit">Continue</button></form>`,
      ),
    );
  });
  app.post('/spr/returns/resolution', requireLogin, (req, res) => {
    state.resolution = String(req.body.resolution ?? '');
    if (!state.resolution) return res.redirect('/spr/returns/resolution');
    res.redirect('/spr/returns/dropoff');
  });

  app.get('/spr/returns/dropoff', requireLogin, (_req, res) => {
    const opt = (v: string, label: string) => `<label class="opt"><input class="hidden-radio" type="radio" name="dropoff" value="${v}"/> ${label}</label>`;
    res.send(
      page(
        'How will you return it?',
        `<h1>How will you return it?</h1><form method="post" action="/spr/returns/dropoff">
        ${opt('pickup', 'Schedule a pickup ($6.99 pickup fee)')}
        ${opt('wholefoods', 'Whole Foods Market drop off — no box needed')}
        ${opt('ups', 'The UPS Store drop off — no box, no label, show a QR code')}
        <button class="a-button" type="submit">Continue</button></form>`,
      ),
    );
  });
  app.post('/spr/returns/dropoff', requireLogin, (req, res) => {
    state.dropoff = String(req.body.dropoff ?? '');
    if (!state.dropoff) return res.redirect('/spr/returns/dropoff');
    res.redirect('/spr/returns/review');
  });

  app.get('/spr/returns/review', requireLogin, (_req, res) => {
    res.send(
      page(
        'Review your return',
        `<h1>Review your return</h1><p>Item: ${state.item} · Reason: ${state.reason} · Refund: ${state.resolution} · Drop off: ${state.dropoff}</p>
        <form method="post" action="/spr/returns/confirm"><button class="a-button" type="submit">Confirm your return</button></form>`,
      ),
    );
  });
  app.post('/spr/returns/confirm', requireLogin, (_req, res) => {
    state.confirmed = true;
    res.redirect('/spr/returns/confirmation');
  });
  app.get('/spr/returns/confirmation', requireLogin, (_req, res) => {
    res.send(
      page(
        'Return confirmed',
        `<h1>Your return is ready</h1><p>Show this QR code at The UPS Store by Oct 18.</p>
        <img alt="Return QR code" width="160" height="160" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='160' height='160' fill='black'/></svg>"/>
        <p>Return code: RQ7-4KX2. Your refund of $79.99 will be issued to your Visa ending in 1234.</p>`,
      ),
    );
  });

  app.get('/gp/buy/again', (_req, res) => {
    state.forbiddenClicks.push('buy-again');
    res.send(page('Cart', '<h1>Added to cart</h1>'));
  });

  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl, state, close: () => server.close() };
}
