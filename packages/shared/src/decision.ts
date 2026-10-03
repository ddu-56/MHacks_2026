import { z } from 'zod';
import { ACTION_TYPES, SITUATIONS, type ActionType } from './vocab';

export const IvrDecisionSchema = z.object({
  situation: z.enum(SITUATIONS),
  action: z.enum(ACTION_TYPES),
  value: z.string().max(200).default(''),
  confidence: z.number().min(0).max(1),
  humanLikelihood: z.number().min(0).max(1).default(0),
  explanation: z.string().min(1).max(240),
});
export type IvrDecision = z.infer<typeof IvrDecisionSchema>;

/** JSON schema handed to Gemini's structured-output mode. Mirrors IvrDecisionSchema. */
export const IVR_DECISION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    situation: { type: 'string', enum: [...SITUATIONS] },
    action: { type: 'string', enum: [...ACTION_TYPES] },
    value: { type: 'string', description: 'Digits for PRESS_KEY, short phrase for SPEAK, else empty.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    humanLikelihood: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Probability the latest speech came from a live human representative.',
    },
    explanation: { type: 'string', description: 'One short user-facing sentence. No hidden reasoning.' },
  },
  required: ['situation', 'action', 'value', 'confidence', 'humanLikelihood', 'explanation'],
} as const;

export const MIN_KEYPRESS_CONFIDENCE = 0.6;
const DIGITS_RE = /^[0-9*#]{1,20}$/;

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', star: '*', pound: '#', hash: '#',
};

/** Lowercases and turns spoken digits ("press three") into numerals ("press 3"). */
export function normalizeSpokenDigits(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|star|pound|hash)\b/g, (w) => NUMBER_WORDS[w]!);
}

/** Digits offered by a menu prompt, e.g. "for billing, press 3" -> ["3"]. */
export function offeredKeys(transcript: string): string[] {
  const norm = normalizeSpokenDigits(transcript);
  const keys = new Set<string>();
  for (const m of norm.matchAll(/\b(?:press|dial|enter|select|choose|option)\s+([0-9*#])/g)) keys.add(m[1]!);
  for (const m of norm.matchAll(/([0-9*#])\s*(?:for|to)\b/g)) keys.add(m[1]!);
  return [...keys];
}

export type ValidationResult =
  | { ok: true; decision: IvrDecision }
  | { ok: false; reason: string; decision: IvrDecision };

function fallbackWait(raw: Partial<IvrDecision> | undefined, reason: string): IvrDecision {
  return {
    situation: raw?.situation ?? 'OTHER',
    action: 'WAIT',
    value: '',
    confidence: 0,
    humanLikelihood: raw?.humanLikelihood ?? 0,
    explanation: reason,
  };
}

/**
 * The only gate between model output and the phone line. Anything that fails
 * here degrades to WAIT; nothing the model writes is executed unchecked.
 */
export function validateDecision(
  raw: unknown,
  ctx: { transcript: string; userContext: string },
): ValidationResult {
  const parsed = IvrDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = 'Model returned an invalid action; waiting instead.';
    return { ok: false, reason, decision: fallbackWait(raw as Partial<IvrDecision>, reason) };
  }
  const d = parsed.data;
  const reject = (reason: string): ValidationResult => ({ ok: false, reason, decision: fallbackWait(d, reason) });

  switch (d.action as ActionType) {
    case 'PRESS_KEY': {
      if (!DIGITS_RE.test(d.value)) return reject(`"${d.value}" is not a valid key sequence.`);
      if (d.confidence < MIN_KEYPRESS_CONFIDENCE) return reject('Not confident enough to choose a menu option.');
      const offered = offeredKeys(ctx.transcript);
      if (d.value.length === 1 && offered.length > 0 && !offered.includes(d.value)) {
        return reject(`Key ${d.value} was not offered by the menu.`);
      }
      if (d.value.length > 1 && !ctx.userContext.replace(/\D/g, '').includes(d.value.replace(/[*#]/g, ''))) {
        return reject('Refusing to enter a number the user did not provide.');
      }
      return { ok: true, decision: d };
    }
    case 'SPEAK': {
      const phrase = d.value.trim();
      if (!phrase) return reject('Nothing to say.');
      if (d.confidence < MIN_KEYPRESS_CONFIDENCE) return reject('Not confident enough to respond out loud.');
      const ctxDigits = ctx.userContext.replace(/\D/g, '');
      for (const seq of phrase.match(/\d{3,}/g) ?? []) {
        if (!ctxDigits.includes(seq)) return reject('Refusing to say numbers the user did not provide.');
      }
      if (/\b(pin|password|passcode|social security|ssn)\b/i.test(phrase)) {
        return reject('Refusing to disclose credentials; handing off to the user.');
      }
      return { ok: true, decision: { ...d, value: phrase } };
    }
    case 'WAIT':
    case 'TRANSFER_TO_USER':
    case 'END_CALL':
      return { ok: true, decision: { ...d, value: '' } };
  }
}
