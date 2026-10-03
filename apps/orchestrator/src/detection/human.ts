/**
 * Multi-signal live-representative detector. Heuristics are cheap and
 * deterministic; the LLM's humanLikelihood is blended in when available.
 * Bridging requires both a high blended score AND a concrete positive signal.
 */

export interface HumanContext {
  wasOnHold: boolean;
  /** Hold music stopped shortly before this speech. */
  musicStopped: boolean;
  previousConfidence: number;
}

export interface HumanScore {
  score: number;
  positive: string[];
  negative: string[];
}

const POSITIVE: Array<[RegExp, number, string]> = [
  [/\bmy name(?:'s| is)\b|\byou(?:'re| are) (?:speaking|talking) (?:with|to)\b/i, 0.35, 'introduced themselves'],
  [/\b[Tt]his is [A-Z][a-z]+(?: with| from| at| in|,|\.)/, 0.3, 'introduced themselves'],
  [/\bhow (?:can|may|could) i (?:help|assist)\b|\bwhat can i (?:do|help)\b|\bhow can we help\b/i, 0.35, 'asked how they can help'],
  [/\b(?:thanks|thank you) (?:so much )?for (?:holding|waiting)\b/i, 0.15, 'thanked us for holding'],
  [/^\s*(?:hi|hello|hey|good (?:morning|afternoon|evening))\b/i, 0.15, 'conversational greeting'],
  [/\b(?:are you there|can you hear me|anyone there)\b/i, 0.3, 'checked if someone is on the line'],
];

const AUTOMATED: Array<[RegExp, string]> = [
  [/\bpress\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|zero|star|pound)\b/i, 'menu options'],
  [/\byour call is (?:very )?important\b/i, 'queue announcement'],
  [/\b(?:please )?(?:stay on the line|continue to hold|remain on the line)\b/i, 'hold instruction'],
  [/\bplease hold\b/i, 'hold instruction'],
  [/\bnext available (?:representative|agent|associate)\b/i, 'queue announcement'],
  [/\b(?:all of )?our (?:representatives|agents|associates) are\b/i, 'queue announcement'],
  [/\b(?:may|might|will) be (?:monitored|recorded)\b/i, 'recording disclaimer'],
  [/\bestimated (?:wait|hold) time\b/i, 'wait-time announcement'],
  [/\bfor (?:english|spanish|español)\b/i, 'language menu'],
];

export function scoreHumanLikelihood(text: string, ctx: HumanContext): HumanScore {
  const positive: string[] = [];
  const negative: string[] = [];
  let score = 0.1;

  for (const [re, weight, label] of POSITIVE) {
    if (re.test(text)) {
      score += weight;
      positive.push(label);
    }
  }
  for (const [re, label] of AUTOMATED) {
    if (re.test(text)) {
      score -= 0.4;
      if (!negative.includes(label)) negative.push(label);
    }
  }
  if (negative.length === 0) {
    if (ctx.wasOnHold) {
      score += 0.15;
      positive.push('speech after hold');
    }
    if (ctx.musicStopped) {
      score += 0.1;
      positive.push('hold music stopped');
    }
    if (/\bI\b|\bI'm\b|\bI'll\b/.test(text) || /\?\s*$/.test(text)) score += 0.05;
    // A second human-sounding utterance right after a suspected one compounds.
    if (ctx.previousConfidence >= 0.5 && positive.length > 0) score += 0.2;
  }
  return { score: clamp(score), positive, negative };
}

/** Blend heuristic score with the model's estimate (if any). */
export function combineConfidence(heuristic: number, llm: number | null): number {
  if (llm === null) return clamp(heuristic);
  return clamp(0.55 * heuristic + 0.45 * llm);
}

export type HumanVerdict = 'CONTINUE' | 'POSSIBLE' | 'DETECTED';

export function classifyHuman(
  confidence: number,
  score: HumanScore,
  thresholds: { detected: number; possible: number },
): HumanVerdict {
  const supported = score.positive.some((p) => p !== 'speech after hold' && p !== 'hold music stopped');
  if (confidence >= thresholds.detected && supported && score.negative.length === 0) return 'DETECTED';
  if (confidence >= thresholds.possible && score.negative.length === 0) return 'POSSIBLE';
  return 'CONTINUE';
}

const HOLD_PATTERNS = [
  /\bplease hold\b/i,
  /\bconnect you (?:to|with) (?:the |a |an )?(?:next available|representative|agent)\b/i,
  /\byour call is (?:very )?important\b/i,
  /\b(?:continue to hold|stay on the line|remain on the line)\b/i,
  /\b(?:representatives|agents|associates) are (?:currently )?(?:assisting|helping|busy)\b/i,
  /\bestimated (?:wait|hold) time\b/i,
  /\bcalls? will be answered in the order\b/i,
];

export function isHoldAnnouncement(text: string): boolean {
  return HOLD_PATTERNS.some((re) => re.test(text));
}

function clamp(n: number) {
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}
