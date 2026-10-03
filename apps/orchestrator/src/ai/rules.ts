import { normalizeSpokenDigits, type IvrDecision } from '@holdless/shared';
import { isHoldAnnouncement, scoreHumanLikelihood } from '../detection/human';
import type { DecisionInput, DecisionOutput, IvrAgent } from './types';

export interface MenuOption {
  key: string;
  label: string;
}

export function parseMenuOptions(transcript: string): MenuOption[] {
  const norm = normalizeSpokenDigits(transcript);
  const found = new Map<string, string>();
  const patterns: Array<[RegExp, 'labelFirst' | 'keyFirst']> = [
    [/(?:^|[.,;]\s*)(?:for|to|if you(?:'re| are| would like| want)?(?: to)?)\s+([^.,;]+?),?\s+(?:please\s+)?(?:press|dial|say)\s+([0-9*#])/g, 'labelFirst'],
    [/(?:press|dial)\s+([0-9*#])\s+(?:for|to)\s+([^.,;]+)/g, 'keyFirst'],
  ];
  for (const [re, order] of patterns) {
    for (const m of norm.matchAll(re)) {
      const [key, label] = order === 'labelFirst' ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
      if (!found.has(key)) found.set(key, label.trim());
    }
  }
  return [...found].map(([key, label]) => ({ key, label }));
}

const CONCEPTS: Record<string, string[]> = {
  billing: ['bill', 'billing', 'charge', 'charged', 'payment', 'refund', 'fee', 'invoice', 'overcharge', 'statement', 'balance'],
  dispute: ['dispute', 'incorrect', 'wrong', 'error', 'unauthorized', 'overcharged', 'mistake', 'never ordered', "didn't order", 'fraud'],
  technical: ['technical', 'tech support', 'internet', 'outage', 'not working', 'broken', 'wifi', 'signal', 'repair', 'troubleshoot'],
  sales: ['sales', 'new plan', 'upgrade', 'buy', 'purchase', 'new service', 'new line'],
  cancel: ['cancel', 'cancellation'],
  reservation: ['reservation', 'booking', 'flight', 'itinerary', 'trip'],
  agent: ['representative', 'agent', 'operator', 'associate', 'someone', 'human', 'person'],
};

const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'for', 'about', 'with', 'my', 'me', 'i', 'talk', 'someone', 'and', 'of', 'on', 'all', 'other', 'questions']);

function concepts(text: string): Set<string> {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const [concept, words] of Object.entries(CONCEPTS)) {
    if (words.some((w) => new RegExp(`\\b${w}`, 'i').test(lower))) hits.add(concept);
  }
  return hits;
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z]+/g)?.filter((w) => w.length > 2 && !STOPWORDS.has(w)) ?? []);
}

export function rankOptions(goal: string, options: MenuOption[]) {
  const goalConcepts = concepts(goal);
  const goalTokens = tokens(goal);
  return options
    .map((o) => {
      let score = 0;
      for (const c of concepts(o.label)) if (goalConcepts.has(c)) score += c === 'agent' ? 0.5 : 1;
      for (const t of tokens(o.label)) if (goalTokens.has(t)) score += 0.5;
      return { ...o, score };
    })
    .sort((a, b) => b.score - a.score);
}

const VERIFICATION = /\b(pin|password|passcode|security (?:question|code)|social security|last four|date of birth|verification code|one[- ]time code)\b/i;

/** Deterministic fallback agent. Used when Gemini is unavailable and as the test oracle. */
export class RuleBasedAgent implements IvrAgent {
  readonly name = 'rules';

  async decide(input: DecisionInput): Promise<DecisionOutput> {
    return { raw: this.decideSync(input), source: 'rules' };
  }

  decideSync({ transcript, userGoal, onHold }: DecisionInput): IvrDecision {
    const options = parseMenuOptions(transcript);
    const human = scoreHumanLikelihood(transcript, { wasOnHold: onHold, musicStopped: false, previousConfidence: 0 });

    if (options.length > 0) {
      const ranked = rankOptions(userGoal, options);
      const [best, second] = ranked;
      if (best && best.score > 0) {
        const clear = !second || best.score > second.score;
        return {
          situation: 'MENU',
          action: 'PRESS_KEY',
          value: best.key,
          confidence: clear ? (best.score >= 2 ? 0.95 : 0.85) : 0.55,
          humanLikelihood: 0,
          explanation: `"${capitalize(best.label)}" is the closest option to your request.`,
        };
      }
      return {
        situation: 'MENU',
        action: 'WAIT',
        value: '',
        confidence: 0.3,
        humanLikelihood: 0,
        explanation: 'None of the options so far match your request; listening for more.',
      };
    }
    if (VERIFICATION.test(transcript)) {
      return {
        situation: 'VERIFICATION',
        action: 'TRANSFER_TO_USER',
        value: '',
        confidence: 0.9,
        humanLikelihood: human.score,
        explanation: 'They are asking for verification only you can provide.',
      };
    }
    if (isHoldAnnouncement(transcript)) {
      return {
        situation: 'HOLD',
        action: 'WAIT',
        value: '',
        confidence: 0.9,
        humanLikelihood: 0,
        explanation: 'In the hold queue; waiting for a representative.',
      };
    }
    if (human.score >= 0.5) {
      return {
        situation: 'HUMAN',
        action: 'TRANSFER_TO_USER',
        value: '',
        confidence: human.score,
        humanLikelihood: human.score,
        explanation: 'A live representative appears to have answered.',
      };
    }
    return {
      situation: 'OTHER',
      action: 'WAIT',
      value: '',
      confidence: 0.6,
      humanLikelihood: human.score,
      explanation: 'Listening for the next prompt.',
    };
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
