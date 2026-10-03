import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, type GenerateContentConfig } from '@google/genai';
import { IVR_DECISION_JSON_SCHEMA } from '@holdless/shared';
import { log } from '../log';
import { RuleBasedAgent } from './rules';
import type { DecisionInput, DecisionOutput, IvrAgent } from './types';

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts/ivr-agent.md'),
  'utf8',
);

const PREFERRED_MODELS = ['gemini-3-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-flash-latest'];

export async function resolveGeminiModel(ai: GoogleGenAI, requested: string): Promise<string> {
  if (requested) return requested;
  try {
    const available = new Set<string>();
    for await (const m of await ai.models.list()) if (m.name) available.add(m.name.replace(/^models\//, ''));
    return PREFERRED_MODELS.find((m) => available.has(m)) ?? 'gemini-2.5-flash';
  } catch (err) {
    log.warn(`Could not list Gemini models (${(err as Error).message}); defaulting to gemini-2.5-flash`);
    return 'gemini-2.5-flash';
  }
}

export function buildUserPrompt(input: DecisionInput): string {
  const history = input.history
    .slice(-6)
    .map((t, i) => `${i + 1}. Heard: "${t.heard}"${t.action ? ` -> You did: ${t.action}` : ''}`)
    .join('\n');
  return [
    `COMPANY: ${input.companyName}`,
    `USER GOAL: ${input.userGoal}`,
    `USER-PROVIDED DETAILS (only these may be shared): ${input.userContext || '(none)'}`,
    `CALL STATE: ${input.onHold ? 'in the hold queue' : 'navigating the automated system'}`,
    history ? `EARLIER IN THIS CALL:\n${history}` : 'EARLIER IN THIS CALL: (nothing yet)',
    `JUST HEARD: "${input.transcript}"`,
    'Decide the single next action.',
  ].join('\n\n');
}

export class GeminiAgent implements IvrAgent {
  readonly name: string;
  private readonly fallback = new RuleBasedAgent();

  constructor(
    private readonly ai: GoogleGenAI,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {
    this.name = `gemini:${model}`;
  }

  async decide(input: DecisionInput): Promise<DecisionOutput> {
    const cfg: GenerateContentConfig = {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseJsonSchema: IVR_DECISION_JSON_SCHEMA,
      temperature: 0,
      abortSignal: AbortSignal.timeout(this.timeoutMs),
      thinkingConfig: this.model.startsWith('gemini-3')
        ? { thinkingLevel: ThinkingLevel.LOW }
        : { thinkingBudget: 0 },
    };
    try {
      const res = await this.ai.models.generateContent({ model: this.model, contents: buildUserPrompt(input), config: cfg });
      const text = res.text ?? '';
      return { raw: JSON.parse(text), source: 'gemini' };
    } catch (err) {
      log.warn(`Gemini failed (${(err as Error).message}); using rule-based fallback for this turn`);
      const out = await this.fallback.decide(input);
      return { ...out, note: 'Gemini unavailable — used rule-based fallback' };
    }
  }
}

export async function createIvrAgent(apiKey: string, model: string, timeoutMs: number): Promise<IvrAgent> {
  if (!apiKey) {
    log.warn('GEMINI_API_KEY not set — IVR reasoning uses the deterministic rule-based agent (MOCKED AI)');
    return new RuleBasedAgent();
  }
  const ai = new GoogleGenAI({ apiKey });
  const resolved = await resolveGeminiModel(ai, model);
  log.info(`IVR reasoning: Gemini ${resolved}`);
  return new GeminiAgent(ai, resolved, timeoutMs);
}
