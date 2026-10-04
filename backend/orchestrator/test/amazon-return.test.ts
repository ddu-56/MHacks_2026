import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openOwnChrome } from '../src/browser/session';
import { AgentStop, AmazonReturnAgent, itemTokens, pickOption, reasonPreferences, type AgentHooks } from '../src/browser/amazon-return';
import { startMockAmazon } from './fixtures/mock-amazon';

let cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.forEach((f) => f());
  cleanup = [];
});

function harness() {
  const statuses: Array<{ status: string; step: string; summary: string }> = [];
  const events: Array<{ kind: string; title: string; description?: string }> = [];
  let approved = false;
  let cancelled = false;
  const hooks: AgentHooks = {
    status: (status, step, summary) => void statuses.push({ status, step, summary }),
    event: (kind, title, description) => void events.push({ kind, title, description }),
    approved: () => approved,
    cancelled: () => cancelled,
  };
  // A failed assertion mustn't leave an agent driving Chrome after the test ends.
  cleanup.push(() => (cancelled = true));
  return { hooks, statuses, events, approve: () => (approved = true), cancel: () => (cancelled = true) };
}

async function agentFor(baseUrl: string, params: { item: string; reason: string; autoConfirm?: boolean; orderNumber?: string }, hooks: AgentHooks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdless-profile-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new AmazonReturnAgent(params, hooks, {
    baseUrl,
    userWaitMs: 15_000,
    openSession: () => openOwnChrome(dir, 'chrome', true),
  });
}

const until = async (pred: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe('return heuristics', () => {
  it('maps free-text reasons to store reasons', () => {
    const opts = ['Choose a response', 'Bought by mistake', 'No longer needed', "Item defective or doesn't work", 'Wrong item was sent'];
    expect(opts[pickOption(opts, reasonPreferences('the scroll wheel is broken'))]).toBe("Item defective or doesn't work");
    expect(opts[pickOption(opts, reasonPreferences('they sent the wrong color'))]).toBe('Wrong item was sent');
    expect(opts[pickOption(opts, reasonPreferences("I don't need it anymore"))]).toBe('No longer needed');
  });
  it('never prefers gift-card refunds, replacements or paid pickups', () => {
    expect(pickOption(['Replacement', 'Refund as Amazon gift card balance'], [/refund/i])).toBe(-1);
    expect(pickOption(['Schedule a pickup ($6.99)', 'UPS Store drop off'], [/ups/i, /pickup/i])).toBe(1);
  });
  it('tokenizes the item without filler words', () => {
    expect(itemTokens('my Logitech wireless mouse from Amazon')).toEqual(['logitech', 'wireless', 'mouse']);
  });
});

describe('AmazonReturnAgent against a stand-in Amazon', () => {
  it('waits for sign-in, finds the right order, fills the wizard, and only submits after approval', async () => {
    const amazon = await startMockAmazon();
    cleanup.push(amazon.close);
    const h = harness();
    const agent = await agentFor(amazon.baseUrl, { item: 'Logitech wireless mouse', reason: 'The scroll wheel is broken' }, h.hooks);
    const run = agent.run();
    run.catch(() => {});

    await until(() => h.statuses.some((s) => s.step === 'Sign in needed'));
    amazon.state.signedIn = true; // you sign in, in the window

    await until(() => h.statuses.some((s) => s.step === 'Ready to submit'));
    expect(amazon.state.confirmed).toBe(false);
    expect(amazon.state).toMatchObject({
      order: '112-9842000-0000000',
      item: 'mouse',
      reason: "Item defective or doesn't work",
      resolution: 'original',
      dropoff: 'ups',
      comment: 'The scroll wheel is broken',
    });

    h.approve();
    const outcome = await run;
    expect(amazon.state.confirmed).toBe(true);
    expect(amazon.state.forbiddenClicks).toEqual([]);
    expect(outcome.details.join(' ')).toMatch(/Return code: RQ7-4KX2/);
    expect(outcome.qrPng?.length).toBeGreaterThan(100);
    expect(h.events.map((e) => e.title)).toEqual(
      expect.arrayContaining(['Opened the return for this order', 'Selected the item', 'Chose the return reason', 'Chose a refund to your original payment method', 'Chose how to send it back', 'Submitted the return']),
    );
  }, 60_000);

  it('submits on its own when autoConfirm is on', async () => {
    const amazon = await startMockAmazon();
    cleanup.push(amazon.close);
    amazon.state.signedIn = true;
    const h = harness();
    const agent = await agentFor(amazon.baseUrl, { item: 'Kindle Paperwhite', reason: 'no longer needed', autoConfirm: true }, h.hooks);
    await agent.run();
    expect(amazon.state).toMatchObject({ order: '114-7777777-7777777', reason: 'No longer needed', confirmed: true });
    expect(h.statuses.some((s) => s.status === 'WAITING_FOR_USER')).toBe(false);
  }, 60_000);

  it('stops cleanly when no order matches', async () => {
    const amazon = await startMockAmazon();
    cleanup.push(amazon.close);
    amazon.state.signedIn = true;
    const h = harness();
    const agent = await agentFor(amazon.baseUrl, { item: 'Nintendo Switch', reason: 'broken' }, h.hooks);
    await expect(agent.run()).rejects.toThrow(AgentStop);
    expect(amazon.state.order).toBe('');
  }, 60_000);

  it('stops when cancelled', async () => {
    const amazon = await startMockAmazon();
    cleanup.push(amazon.close);
    const h = harness();
    const agent = await agentFor(amazon.baseUrl, { item: 'mouse', reason: 'broken' }, h.hooks);
    const run = agent.run();
    await until(() => h.statuses.some((s) => s.step === 'Sign in needed'));
    h.cancel();
    await expect(run).rejects.toThrow(/Cancelled/);
  }, 60_000);
});

describe('parseReturnParams', async () => {
  const { parseReturnParams } = await import('../src/tasks/manager');
  const row = (paramsJson: string, query = 'Return my mouse') => ({ paramsJson, query }) as never;
  it('reads params and defaults safely', () => {
    expect(parseReturnParams(row(JSON.stringify({ item: 'mouse', reason: 'broken', autoConfirm: true })))).toEqual({
      item: 'mouse',
      reason: 'broken',
      orderNumber: undefined,
      autoConfirm: true,
    });
    expect(parseReturnParams(row('garbage'))).toMatchObject({ item: 'Return my mouse', autoConfirm: false });
    expect(parseReturnParams(row(JSON.stringify({ item: 'x', reason: 'y', autoConfirm: 'yes' }))).autoConfirm).toBe(false);
  });
});
