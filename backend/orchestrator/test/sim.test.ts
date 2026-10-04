import { describe, expect, it } from 'vitest';
import { DEMO_PROFILE } from '@holdless/shared';
import { RuleBasedAgent } from '../src/ai/rules';
import { CallRunner } from '../src/runner';
import { MemoryStore } from '../src/store/memory';
import { MockTelephony } from '../src/telephony/mock';
import type { Difficulty, Outcome } from '../src/telephony/sim/wolverine';

interface RunResult {
  seed: number;
  status: string;
  error: string;
  outcome: Outcome;
  bridgedBeforeHuman: boolean;
  redials: number;
  handoff: boolean;
}

/**
 * Everything runs SCALE× faster, the company's speech pacing *and* the agent's patience,
 * so menus arrive in the same fragments a real call produces.
 */
const SCALE = 0.05;

/** One full call: real CallRunner + rule-based reasoning vs. the simulated contact center. */
async function simulate(seed: number, difficulty: Difficulty): Promise<RunResult> {
  let bridgedBeforeHuman = false;
  const telephony = new MockTelephony({ timeScale: SCALE, holdSeconds: 12, holdAnnouncementSeconds: 6, scenario: difficulty, seed });
  class Store extends MemoryStore {
    override async humanDetected(callId: bigint, confidence: number, evidence: string) {
      if (!telephony.sims.get(callId)?.outcome.reachedHuman) bridgedBeforeHuman = true;
      return super.humanDetected(callId, confidence, evidence);
    }
  }
  const store = new Store();
  store.addCall({
    id: 1n,
    companyName: DEMO_PROFILE.companyName,
    phoneNumber: DEMO_PROFILE.phoneNumber,
    userGoal: DEMO_PROFILE.userGoal,
    userPhoneNumber: '+15555550100',
    userContext: DEMO_PROFILE.userContext,
    demo: true,
  });
  let done = false;
  const runner = new CallRunner(store.getCall(1n)!, {
    store,
    telephony,
    agent: new RuleBasedAgent(),
    settings: {
      humanThreshold: 0.8,
      possibleHumanThreshold: 0.5,
      utteranceGapMs: 1100 * SCALE, // DEMO_MODE defaults, scaled
      menuGapMs: 2600 * SCALE,
      maxKeyPresses: 14,
      maxHoldMinutes: 2,
      userAnswerTimeoutSeconds: 10,
    },
    onFinished: () => (done = true),
  });
  await store.claim(1n);
  await runner.start();
  const deadline = Date.now() + 40_000;
  while (!done && store.getCall(1n)!.status !== 'USER_CONNECTED' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  await runner.cancel();
  const call = store.getCall(1n)!;
  const status = store.statusHistory.includes('USER_CONNECTED') ? 'USER_CONNECTED' : call.status;
  return {
    seed,
    status,
    error: store.events.find((e) => e.type === 'CALL_FAILED')?.description ?? '',
    outcome: telephony.sims.get(1n)!.outcome,
    bridgedBeforeHuman,
    redials: store.events.filter((e) => /calling back/i.test(e.title)).length,
    handoff: store.events.some((e) => e.type === 'HANDOFF_REQUIRED'),
  };
}

async function batch(difficulty: Difficulty, seeds: number[]) {
  const results: RunResult[] = [];
  for (let i = 0; i < seeds.length; i += 6) results.push(...(await Promise.all(seeds.slice(i, i + 6).map((s) => simulate(s, difficulty)))));
  const n = results.length;
  const pct = (k: number) => `${Math.round((100 * k) / n)}%`;
  const connected = results.filter((r) => r.status === 'USER_CONNECTED');
  console.log(
    [
      `\n${difficulty.toUpperCase()} — ${n} randomized calls`,
      `  reached a person & connected you: ${connected.length}/${n} (${pct(connected.length)})`,
      `  …in billing: ${connected.filter((r) => r.outcome.department === 'billing').length}/${connected.length}`,
      `  handed off for verification: ${results.filter((r) => r.handoff).length}`,
      `  recovered from drops/busy by calling back: ${results.filter((r) => r.redials > 0 && r.status === 'USER_CONNECTED').length}`,
      `  needed a call-back after a company hang-up (agent mistake or failure): ${results.filter((r) => r.outcome.endedBy === 'company-hangup').length}`,
      `  mistakes — bought upsell: ${results.filter((r) => r.outcome.boughtUpsell).length}, took callback: ${results.filter((r) => r.outcome.tookCallback).length}, took text link: ${results.filter((r) => r.outcome.tookTextLink).length}, typed SSN digits: ${results.filter((r) => r.outcome.gaveSsnDigits).length}, bridged a bot: ${results.filter((r) => r.bridgedBeforeHuman).length}`,
      ...results.filter((r) => r.status !== 'USER_CONNECTED').map((r) => `  seed ${r.seed}: ${r.status}${r.handoff ? ' (verification handoff)' : ''} — ${r.error || r.outcome.path.slice(-4).join(' → ')}`),
    ].join('\n'),
  );
  return results;
}

const seeds = (n: number, from: number) => Array.from({ length: n }, (_, i) => from + i * 7919);

describe('agent vs. simulated contact center (randomized)', () => {
  it('realistic: gets through menus, assistants, offers, misroutes, drops and decoys', async () => {
    const results = await batch('realistic', seeds(36, 101));
    for (const r of results) {
      expect(r.outcome.boughtUpsell, `seed ${r.seed} bought the upsell`).toBe(false);
      expect(r.outcome.tookCallback, `seed ${r.seed} took a callback`).toBe(false);
      expect(r.outcome.tookTextLink, `seed ${r.seed} took the text link`).toBe(false);
      expect(r.bridgedBeforeHuman, `seed ${r.seed} bridged a bot`).toBe(false);
    }
    const connected = results.filter((r) => r.status === 'USER_CONNECTED');
    expect(connected.length / results.length).toBeGreaterThanOrEqual(0.9);
    expect(connected.filter((r) => r.outcome.department === 'billing').length / connected.length).toBeGreaterThanOrEqual(0.85);
  }, 180_000);

  it('chaos: never does anything harmful, and every failure is explained', async () => {
    const results = await batch('chaos', seeds(30, 5003));
    for (const r of results) {
      expect(r.outcome.boughtUpsell, `seed ${r.seed}`).toBe(false);
      expect(r.outcome.gaveSsnDigits, `seed ${r.seed} typed SSN digits`).toBe(false);
      expect(r.bridgedBeforeHuman, `seed ${r.seed} bridged a bot`).toBe(false);
      if (r.status === 'FAILED') expect(r.error.length, `seed ${r.seed} failed without a reason`).toBeGreaterThan(10);
      if (r.outcome.path.includes('verify-ssn') && !r.outcome.reachedHuman) expect(r.handoff || r.status === 'FAILED').toBe(true);
    }
    expect(results.filter((r) => r.status === 'USER_CONNECTED').length).toBeGreaterThan(results.length / 2);
  }, 180_000);
});
