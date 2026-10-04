import { GoogleGenAI } from '@google/genai';
import { resolveGeminiModel } from '../ai/gemini';
import { log } from '../log';

type Element = { selector: string; tag: string; text: string };

const SCHEMA = {
  type: 'object',
  properties: {
    index: { type: 'integer', description: 'Number of the control to click, or -1 if none is right.' },
    explanation: { type: 'string' },
  },
  required: ['index', 'explanation'],
} as const;

/**
 * LLM fallback for unfamiliar return-flow pages. It may only answer with the
 * number of one already-vetted visible control; anything else is ignored.
 */
export async function createReturnAssist(apiKey: string, model: string) {
  if (!apiKey) return undefined;
  const ai = new GoogleGenAI({ apiKey });
  const resolved = await resolveGeminiModel(ai, model);
  log.info(`Browser agent fallback: Gemini ${resolved}`);
  return async (goal: string, pageText: string, elements: Element[]): Promise<string | null> => {
    const list = elements.map((e, i) => `${i}. <${e.tag}> ${e.text}`).join('\n');
    const res = await ai.models.generateContent({
      model: resolved,
      contents: `GOAL: ${goal}\n\nPAGE TEXT (truncated):\n${pageText}\n\nCLICKABLE CONTROLS:\n${list}\n\nWhich single control moves the return forward? Answer -1 if none.`,
      config: {
        systemInstruction:
          'You help an agent complete a product return on a shopping site. Only pick controls that continue the return. Never pick anything that buys, cancels orders, changes payment, or signs out.',
        responseMimeType: 'application/json',
        responseJsonSchema: SCHEMA,
        temperature: 0,
        abortSignal: AbortSignal.timeout(10_000),
      },
    });
    const { index } = JSON.parse(res.text ?? '{}') as { index?: number };
    return typeof index === 'number' && index >= 0 && index < elements.length ? elements[index]!.selector : null;
  };
}
