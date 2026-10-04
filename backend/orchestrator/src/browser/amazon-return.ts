import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import type { ReturnTaskParams, TaskEventKind } from '@holdless/shared';
import type { BrowserSession } from './session';

const INPAGE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'inpage.js'), 'utf8');

/** Never clicked, whatever the page or the model says. */
export const FORBIDDEN = /buy (it )?(now|again)|add to (cart|basket|list)|place (your )?order|proceed to checkout|checkout|subscribe|cancel (this |your )?(order|items?|subscription)|archive|delete|remove|add (a )?(new )?(card|payment)|change payment|gift card|replacement|exchange|sign out|prime/i;
const RETURN_LINK = '^(return or replace items?|return items?|return or replace|start a return|return this item|return)$';
const CONTINUE = /^(continue|next|continue to next step|next step|proceed)$/i;
const CONFIRM = /^(confirm (your )?return|submit (your )?return|confirm and (print|get label)|complete (your )?return)$/i;
const DONE = /(your return is (ready|confirmed|being processed|submitted|started)|return (request )?(was |has been )?(submitted|started|created|confirmed)|show (this|the) qr code|return code|drop.?off code|we('|’)ll (email|send) you (a|the) (refund|return))/i;
const STRONG_DONE = /(your return is (ready|confirmed|submitted)|show (this|the) qr code|return (request )?(has been|was) (submitted|created|confirmed))/i;
const INELIGIBLE = /(not eligible for (a )?return|no longer eligible|return window (has )?(closed|ended)|can('|’)t be returned|non.?returnable)/i;
const ORDERS_PAGE = /(your orders|order placed|order #|orders? history)/i;

const REASONS: Array<[RegExp, RegExp[]]> = [
  [/defect|broke|broken|doesn'?t work|does not work|not working|stopped working|malfunction|faulty|dead|scroll wheel|won'?t (turn|charge|connect)/i, [/defective|does not work|doesn'?t work|not working|item defective/i, /damaged/i]],
  [/damaged|cracked|dented|shattered/i, [/damaged/i, /defective/i]],
  [/wrong (item|size|color|colour|model)|not what i ordered|different/i, [/wrong item|received wrong|incorrect item/i, /not as described|different from/i]],
  [/missing (part|piece|accessor)/i, [/missing (parts|accessories)/i]],
  [/late|too long|arrived after/i, [/arrived too late|late/i]],
  [/no longer need|don'?t need|changed my mind|not needed|unwanted|accidental|by mistake/i, [/no longer needed|changed my mind|don'?t need/i, /bought by mistake|accidental/i]],
  [/cheaper|better price|lower price/i, [/better price/i]],
  [/not as described|description/i, [/not as described|inaccurate/i]],
];

/** Store return reasons to prefer for the user's free-text reason, most specific first. */
export function reasonPreferences(reason: string): RegExp[] {
  for (const [match, prefs] of REASONS) if (match.test(reason)) return prefs;
  return [/defective|does not work/i];
}

const REFUND_PREFS = [/refund.*(original|card|payment)|original payment|credit card|debit|back to (your )?card/i, /refund/i];
const DROPOFF_PREFS = [/ups store|qr code/i, /drop.?off|no box/i, /ups|whole foods|kohl|locker|staples|usps|post office|counter/i];
const DROPOFF_HINT = /ups|whole foods|kohl|drop.?off|locker|staples|usps|fedex|carrier|qr|pickup|pick up|ship it back/i;
const RESOLUTION_HINT = /refund|replacement|exchange|gift card|original payment/i;
const AVOID_OPTION = /gift card|balance|replacement|exchange|schedule (a )?pickup|pick.?up fee/i;

/** Index of the option best matching the preference list, or -1. Avoided options never win. */
export function pickOption(labels: string[], prefs: RegExp[]): number {
  let best = -1;
  let bestScore = 0;
  labels.forEach((label, i) => {
    if (AVOID_OPTION.test(label) || FORBIDDEN.test(label)) return;
    const idx = prefs.findIndex((p) => p.test(label));
    const score = idx === -1 ? 0 : prefs.length - idx;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

export function itemTokens(item: string): string[] {
  const stop = new Set(['the', 'a', 'an', 'my', 'for', 'and', 'with', 'of', 'to', 'on', 'from', 'amazon', 'order', 'return', 'item']);
  return [...new Set(item.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((t) => t.length > 1 && !stop.has(t));
}

export interface AgentHooks {
  status(status: 'RUNNING' | 'WAITING_FOR_USER', step: string, summary: string): Promise<void> | void;
  event(kind: TaskEventKind, title: string, description?: string): Promise<void> | void;
  screenshot?(png: Buffer): void;
  /** True once the user approved the pending final step. */
  approved(): boolean;
  cancelled(): boolean;
}

export interface AgentOptions {
  baseUrl: string;
  /** Opens the HoldLess Chrome window to work in. Released when done. */
  openSession(): Promise<BrowserSession>;
  userWaitMs: number;
  /** Optional LLM fallback: given the goal and visible clickables, return one selector or null. */
  assist?(goal: string, pageText: string, elements: Array<{ selector: string; tag: string; text: string }>): Promise<string | null>;
  /** Keep the window open this long after finishing so you can see the result. */
  lingerMs?: number;
}

export interface ReturnOutcome {
  summary: string;
  details: string[];
  confirmationPng?: Buffer;
  qrPng?: Buffer;
}

export class AgentStop extends Error {}

type PageKind = 'login' | 'done' | 'ineligible' | 'confirm' | 'orders' | 'form';

const MAX_STEPS = 30;

/**
 * Drives a store's return flow in a real, visible Chrome window.
 * Fixed heuristics do the work (find the order, pick the item, reason, refund to
 * original payment, drop-off), an optional LLM helps only when a page is unfamiliar,
 * and anything it can't or shouldn't do (sign-in, 2FA, the final confirm unless
 * autoConfirm) is handed to you in the same window.
 */
export class AmazonReturnAgent {
  private page!: Page;
  /** Set once the final confirm step was reached; "done" text before that is about other orders. */
  private reachedConfirm = false;

  constructor(
    private readonly params: ReturnTaskParams,
    private readonly hooks: AgentHooks,
    private readonly opts: AgentOptions,
  ) {}

  private hl<T>(expr: string): Promise<T> {
    return this.page.evaluate(`window.__holdless.${expr}`) as Promise<T>;
  }

  private checkCancel() {
    if (this.hooks.cancelled()) throw new AgentStop('Cancelled');
  }

  private async snap() {
    if (!this.hooks.screenshot) return;
    try {
      this.hooks.screenshot(await this.page.screenshot({ type: 'png' }));
    } catch {}
  }

  private async settle() {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    await this.page.waitForTimeout(700);
    // Init scripts run on navigation; make sure the toolkit exists even on odd pages.
    const ready = await this.page.evaluate('!!window.__holdless').catch(() => false);
    if (!ready) await this.page.addScriptTag({ content: INPAGE }).catch(() => {});
  }

  private async click(selector: string, what: string) {
    const loc = this.page.locator(selector).first();
    const text = ((await loc.innerText().catch(() => '')) || (await loc.getAttribute('value').catch(() => '')) || '').trim();
    if (FORBIDDEN.test(text)) throw new AgentStop(`Refusing to click "${text}"`);
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: 10_000 });
    await this.hooks.event('action', what, text && text !== what ? `Clicked "${text.slice(0, 80)}"` : undefined);
  }

  private async waitForChange(before: string, ms = 10_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await this.page.waitForTimeout(400);
      const now = await this.hl<string>('signature()').catch(() => '');
      if (now && now !== before) return true;
    }
    return false;
  }

  private async classify(): Promise<PageKind> {
    const url = this.page.url();
    if (/\/ap\/(signin|mfa|cvf|challenge)|\/ax\/claim|validatecaptcha|\/errors\/validate/i.test(url) || (await this.hl<boolean>('isLogin()'))) {
      return 'login';
    }
    const text = await this.hl<string>('pageText()');
    if (await this.hl<unknown>(`findByText(${JSON.stringify(CONFIRM.source)}, 'i')`)) return 'confirm';
    const ordersList = /order-history|your-orders\/orders/i.test(url) || ORDERS_PAGE.test(text.slice(0, 600));
    if (ordersList && (await this.hl<unknown>(`findByText(${JSON.stringify(RETURN_LINK)}, 'i')`))) return 'orders';
    if ((this.reachedConfirm && DONE.test(text)) || (!ordersList && STRONG_DONE.test(text))) return 'done';
    if (!ordersList && INELIGIBLE.test(text) && !(await this.hl<unknown>(`findByText(${JSON.stringify(CONTINUE.source)}, 'i')`))) return 'ineligible';
    return 'form';
  }

  /** Hands the window to the user and waits until `done()` or an approval. */
  private async waitForUser(step: string, ask: string, done: () => Promise<boolean>) {
    await this.hooks.status('WAITING_FOR_USER', step, ask);
    await this.hooks.event('wait', step, ask);
    await this.page.bringToFront().catch(() => {});
    const end = Date.now() + this.opts.userWaitMs;
    while (Date.now() < end) {
      this.checkCancel();
      if (this.hooks.approved() || (await done().catch(() => false))) {
        await this.hooks.status('RUNNING', 'Continuing', 'Taking back over');
        return;
      }
      await this.page.waitForTimeout(1000);
    }
    throw new AgentStop(`Timed out waiting for you: ${ask}`);
  }

  private ordersUrl() {
    return `${this.opts.baseUrl}/gp/css/order-history`;
  }

  async run(): Promise<ReturnOutcome> {
    await this.hooks.status('RUNNING', 'Opening Chrome', 'Starting the HoldLess Chrome window');
    const session = await this.opts.openSession();
    this.page = session.page;
    // Scoped to this one tab: never injected into your other tabs.
    await this.page.addInitScript({ content: INPAGE });
    try {
      return await this.drive();
    } finally {
      // Linger briefly so you can see the result before the window closes.
      if (this.opts.lingerMs) await this.page.waitForTimeout(this.opts.lingerMs).catch(() => {});
      await session.close();
    }
  }

  private async drive(): Promise<ReturnOutcome> {
    const { item, reason, orderNumber } = this.params;
    const tokens = itemTokens(item);
    await this.hooks.status('RUNNING', 'Opening your orders', `Looking for "${item}"`);
    await this.page.goto(this.ordersUrl(), { waitUntil: 'domcontentloaded' });

    let stuck = 0;
    let lastSignature = '';
    let ordersPages = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      this.checkCancel();
      await this.settle();
      await this.snap();
      const kind = await this.classify();
      const signature = await this.hl<string>('signature()');

      if (kind === 'login') {
        await this.waitForUser(
          'Sign in needed',
          'Sign in to Amazon in the HoldLess Chrome window (password / 2FA stay with you). I continue automatically once you are in.',
          async () => (await this.classify()) !== 'login',
        );
        if (!/order-history|your-orders|returns|spr/i.test(this.page.url())) {
          await this.page.goto(this.ordersUrl(), { waitUntil: 'domcontentloaded' });
        }
        continue;
      }

      if (kind === 'done') return this.finish();

      if (kind === 'ineligible') {
        const text = await this.hl<string>('pageText()');
        throw new AgentStop(`Amazon says this item can't be returned: "${text.match(INELIGIBLE)?.[0] ?? 'not eligible'}"`);
      }

      if (kind === 'orders') {
        const link = await this.hl<{ selector: string; score: number; snippet: string } | null>(
          `findReturnLink(${JSON.stringify({ linkSource: RETURN_LINK, tokens, orderNumber })})`,
        );
        if (link && (link.score > 0 || (!tokens.length && !orderNumber))) {
          await this.hooks.status('RUNNING', 'Found the order', link.snippet.slice(0, 160));
          await this.click(link.selector, 'Opened the return for this order');
          await this.waitForChange(signature);
          continue;
        }
        const next = await this.hl<{ selector: string } | null>(`findByText('^(next|next page|→)$', 'i')`);
        if (next && ordersPages++ < 4) {
          await this.click(next.selector, 'Checked the next page of orders');
          await this.waitForChange(signature);
          continue;
        }
        throw new AgentStop(`No returnable order matching "${orderNumber || item}" was found in your recent orders.`);
      }

      if (kind === 'confirm') {
        this.reachedConfirm = true;
        const confirm = await this.hl<{ selector: string; text: string }>(`findByText(${JSON.stringify(CONFIRM.source)}, 'i')`);
        await this.snap();
        if (!this.params.autoConfirm) {
          await this.waitForUser(
            'Ready to submit',
            `Everything is filled in. Review the return in the window, then approve here (or click "${confirm.text}" yourself).`,
            async () => (await this.hl<string>('signature()')) !== signature,
          );
          if ((await this.hl<string>('signature()')) !== signature) continue; // you clicked it yourself
        }
        await this.hooks.status('RUNNING', 'Submitting the return', confirm.text);
        await this.click(confirm.selector, 'Submitted the return');
        await this.waitForChange(signature, 15_000);
        continue;
      }

      // A step of the return wizard: fill what we understand, then continue.
      const acted = await this.fillForm(tokens, reason);
      const cont = await this.hl<{ selector: string; text: string } | null>(`findByText(${JSON.stringify(CONTINUE.source)}, 'i')`);
      if (cont) {
        await this.hooks.status('RUNNING', 'Working through the return form', acted.join(' · ') || 'Continuing');
        await this.click(cont.selector, 'Continued to the next step');
        if (await this.waitForChange(signature)) {
          stuck = 0;
          continue;
        }
      }

      stuck = signature === lastSignature ? stuck + 1 : 1;
      lastSignature = signature;
      if (stuck >= 2 && (await this.tryAssist(signature))) continue;
      if (stuck >= 2 || !cont) {
        await this.waitForUser(
          'Your help needed',
          "I'm not sure how to finish this page. Please do this step in the Chrome window; I'll take over again when the page changes.",
          async () => (await this.hl<string>('signature()')) !== signature,
        );
        stuck = 0;
      }
    }
    throw new AgentStop('The return took more steps than expected; stopping to be safe.');
  }

  /** Checks the item, picks the reason / refund / drop-off options, and adds a short comment. */
  private async fillForm(tokens: string[], reason: string): Promise<string[]> {
    const did: string[] = [];

    const boxes = await this.hl<Array<{ selector: string; target: string; label: string; checked: boolean }>>('checkboxes()');
    const itemBoxes = boxes.filter((b) => !/agree|terms|remember|subscribe|email me|newsletter/i.test(b.label));
    const scored = itemBoxes.map((b) => ({ ...b, score: tokens.filter((t) => b.label.toLowerCase().includes(t)).length }));
    const bestBox = scored.sort((a, b) => b.score - a.score)[0];
    if (bestBox && !bestBox.checked && (bestBox.score > 0 || itemBoxes.length === 1) && !itemBoxes.some((b) => b.checked)) {
      await this.page.locator(bestBox.selector).check({ force: true, timeout: 5000 }).catch(() => this.page.locator(bestBox.target).click());
      did.push('selected the item');
      await this.hooks.event('action', 'Selected the item', bestBox.label.slice(0, 160));
    }

    const prefs = reasonPreferences(reason);
    for (const sel of await this.hl<Array<{ selector: string; options: string[]; selectedIndex: number; label: string }>>('selects()')) {
      const placeholder = sel.selectedIndex <= 0 || /choose|select|please/i.test(sel.options[sel.selectedIndex] ?? '');
      if (!placeholder) continue;
      const idx = pickOption(sel.options, prefs);
      if (idx < 0) continue;
      await this.page.locator(sel.selector).selectOption({ index: idx }, { force: true, timeout: 5000 }).catch(() => {});
      await this.hl(`setSelect(${JSON.stringify(sel.selector)}, ${idx})`);
      did.push(`reason: ${sel.options[idx]}`);
      await this.hooks.event('action', 'Chose the return reason', sel.options[idx]);
    }

    for (const group of await this.hl<Array<{ name: string; options: Array<{ selector: string; target: string; label: string; checked: boolean }> }>>('radioGroups()')) {
      if (group.options.some((o) => o.checked)) continue;
      const labels = group.options.map((o) => o.label);
      let prefsFor: RegExp[] | null = null;
      let what = '';
      if (labels.some((l) => RESOLUTION_HINT.test(l))) [prefsFor, what] = [REFUND_PREFS, 'Chose a refund to your original payment method'];
      else if (labels.some((l) => DROPOFF_HINT.test(l))) [prefsFor, what] = [DROPOFF_PREFS, 'Chose how to send it back'];
      else if (labels.some((l) => prefs.some((p) => p.test(l)))) [prefsFor, what] = [prefs, 'Chose the return reason'];
      if (!prefsFor) continue;
      const idx = pickOption(labels, prefsFor);
      if (idx < 0) continue;
      const opt = group.options[idx]!;
      await this.page.locator(opt.selector).check({ force: true, timeout: 5000 }).catch(() => this.page.locator(opt.target).click());
      did.push(opt.label.slice(0, 60));
      await this.hooks.event('action', what, opt.label.slice(0, 160));
    }

    for (const ta of await this.hl<Array<{ selector: string; value: string; label: string }>>('textareas()')) {
      if (ta.value.trim() || /gift|note to seller|review/i.test(ta.label)) continue;
      await this.page.locator(ta.selector).fill(reason.slice(0, 250));
      did.push('added a comment');
      await this.hooks.event('action', 'Described the problem', reason.slice(0, 160));
    }
    return did;
  }

  /** Unfamiliar page: let the LLM pick one safe control from what's visible. */
  private async tryAssist(signature: string): Promise<boolean> {
    if (!this.opts.assist) return false;
    const elements = await this.hl<Array<{ selector: string; tag: string; text: string }>>('describeClickables(60)');
    const safe = elements.filter((e) => !FORBIDDEN.test(e.text) && !CONFIRM.test(e.text));
    const goal = `Start a return for "${this.params.item}" because "${this.params.reason}", refund to the original payment method, any drop-off option. Do not submit the final confirmation.`;
    const choice = await this.opts.assist(goal, (await this.hl<string>('pageText()')).slice(0, 4000), safe).catch(() => null);
    const pick = safe.find((e) => e.selector === choice);
    if (!pick) return false;
    await this.click(pick.selector, `Took the next step (AI-assisted): ${pick.text}`);
    return this.waitForChange(signature);
  }

  private async finish(): Promise<ReturnOutcome> {
    const text = await this.hl<string>('pageText()');
    const sentences = text.split(/(?<=[.!?])\s+|\s{2,}/);
    const details = sentences
      .filter((s) => /return (code|id|number)|drop.?off|refund|qr code|by [A-Z][a-z]{2,8},? [A-Z][a-z]{2}/i.test(s))
      .map((s) => s.trim().slice(0, 200))
      .slice(0, 5);
    const confirmationPng = await this.page.screenshot({ type: 'png', fullPage: true }).catch(() => undefined);
    const qr = await this.hl<string | null>('qrImage()');
    const qrPng = qr ? await this.page.locator(qr).screenshot().catch(() => undefined) : undefined;
    if (confirmationPng) this.hooks.screenshot?.(confirmationPng);
    return { summary: `Return started for ${this.params.item}`, details, confirmationPng, qrPng };
  }
}
