import { normalizeSpokenDigits, type IvrDecision } from '@holdless/shared';
import { isHoldAnnouncement, scoreHumanLikelihood } from '../detection/human';
import type { DecisionInput, DecisionOutput, IvrAgent } from './types';

export interface MenuOption {
  key: string;
  label: string;
}

/** "For billing, press 3" / "Press 1 for yes, or 2 for no" / "If you don't have it, press star" → options. */
export function parseMenuOptions(transcript: string): MenuOption[] {
  const norm = normalizeSpokenDigits(transcript);
  const found = new Map<string, string>();
  const patterns: Array<[RegExp, 'labelFirst' | 'keyFirst']> = [
    // Labels may contain commas ("For billing, payments, and your account, press 3"); only sentence ends delimit them.
    [/(?:^|[.;?!]\s*|,\s*(?=(?:for|to|if)\b))(?:for|to|if)\s+([^.;?!]+?),?\s+(?:please\s+)?(?:press|dial|say|enter)\s+([0-9*#])(?![0-9])/g, 'labelFirst'],
    [/(?:press|dial)\s+([0-9*#])\s+(?:for|to)\s+([^.,;?!]+)/g, 'keyFirst'],
    [/(?:,|\bor)\s+([0-9*#])\s+(?:for|to)\s+([^.,;?!]+)/g, 'keyFirst'],
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
  billing: ['bill', 'billing', 'charge', 'charged', 'payment', 'refund', 'fee', 'invoice', 'overcharge', 'statement', 'balance', 'account and billing'],
  dispute: ['dispute', 'incorrect', 'wrong', 'error', 'unauthorized', 'overcharged', 'mistake', 'never ordered', "didn't order", 'fraud', 'recent activity', 'look right', 'unrecognized', 'question about a charge', 'about a charge'],
  technical: ['technical', 'tech support', 'internet', 'outage', 'not working', 'broken', 'wifi', 'signal', 'repair', 'troubleshoot', 'device'],
  sales: ['sales', 'new plan', 'upgrade', 'buy', 'purchase', 'new service', 'new line', 'shop'],
  cancel: ['cancel', 'cancellation'],
  reservation: ['reservation', 'booking', 'flight', 'itinerary', 'trip'],
  agent: ['representative', 'agent', 'operator', 'associate', 'someone', 'human', 'person', 'specialist'],
};

const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'for', 'about', 'with', 'my', 'me', 'i', 'talk', 'someone', 'and', 'of', 'on', 'all', 'other', 'questions', 'your', 'you', 'press']);

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

/** A few words a speech-recognizing assistant can route on. */
export function describeGoal(goal: string, short = false): string {
  const c = concepts(goal);
  if (c.has('billing') && c.has('dispute')) return short ? 'billing' : 'a wrong charge on my bill';
  if (c.has('billing')) return short ? 'billing' : 'a question about my bill';
  if (c.has('technical')) return short ? 'technical support' : "my service isn't working";
  if (c.has('cancel')) return short ? 'cancel service' : 'canceling my service';
  if (c.has('reservation')) return short ? 'reservations' : 'a problem with my reservation';
  if (c.has('sales')) return short ? 'sales' : 'a new plan';
  const topic = goal
    .replace(/^(?:please\s+)?(?:i (?:want|need) to\s+)?(?:talk|speak) (?:to|with) (?:someone|a human|a person|an agent|a representative)\s+(?:about|regarding)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .replace(/\$?\d[\d,.]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return short ? 'representative' : topic.split(' ').slice(0, 8).join(' ') || 'a question about my account';
}

const VERIFY_SENSITIVE = /\b(social security|ssn|last four|pin\b|password|passcode|security (?:question|code)|date of birth|verification code|one[- ]time code|mother'?s maiden)/i;
const ACCOUNT_PROMPT = /\b(account|member|policy|order|confirmation|phone) (number|#|id)\b.*\b(enter|say|key in|provide)|\b(enter|say|key in|provide)\b.*\b(account|member|policy|order|confirmation) (number|#|id)\b/i;
const CLOSED = /\b(offices? (are|is) (currently )?closed|we are (currently )?closed|outside (of )?(our )?(normal )?business hours|call back (during|between))\b/i;
const YES_NO = /\b(is that (right|correct)|did you say|did i get that right|say yes or no|is this about|am i right)\b/i;
const OPEN_PROMPT = /\b(tell me (why|what|in)|in a few words|briefly (tell|describe|say)|what('s| is) (the reason|it about)|what (are you|you're) calling about|what can i (help|do) you with|you can say things like)\b/i;
const OFFER_ACCEPT = /\b(text( message)?|link|call (you )?back|callback|survey|hear (more|about)|this offer|add .{0,40} to your account|sign up|enroll|subscribe|download|app\b|instead)\b/i;
const OFFER_DECLINE = /\b(keep (holding|waiting)|continue (holding|waiting|to hold)|hold for|stay on the line|go back|no thanks|not interested|return to|^no$)\b/i;
const STAY_ON_LINE = /\b(otherwise|or just|to keep holding|to continue holding|keep waiting)\b.{0,40}\b(stay on the line|remain on the line|do nothing|hold)\b|\bstay on the line\b/i;
const REPEAT = /\b(hear (these|the|those) (options|choices) again|repeat (this|these|the) (menu|options))\b/i;
const GO_BACK = /\b(main menu|go back|start over|previous menu)\b/i;
const CATCH_ALL = /\b(anything else|all other|other questions|something else|representative|agent|operator|speak (to|with) (someone|a person))\b/i;
const NON_ENGLISH = /\b(espa(n|ñ)ol|fran(c|ç)ais|oprima|marque)\b/i;
const CONSEQUENTIAL = /\b(pay (now|your bill now|today)|make a payment|add .{0,40} to your account|purchase|buy|upgrade (now|today)|confirm (the |your )?(payment|purchase|order|cancellation)|cancel (your|my) (service|account|line))\b/i;
const RETRY_HINT = /\b(didn'?t (get|catch|hear) (that|anything)|try that again|not a valid|let'?s try|i need you to say)\b/i;

/** Labels for options HoldLess must never pick on its own, whatever the reasoning engine says. */
export function isConsequentialOption(label: string): boolean {
  return CONSEQUENTIAL.test(label);
}

function wait(situation: IvrDecision['situation'], explanation: string, confidence = 0.7, humanLikelihood = 0): IvrDecision {
  return { situation, action: 'WAIT', value: '', confidence, humanLikelihood, explanation };
}

function press(key: string, explanation: string, confidence = 0.85, situation: IvrDecision['situation'] = 'MENU'): IvrDecision {
  return { situation, action: 'PRESS_KEY', value: key, confidence, humanLikelihood: 0, explanation };
}

function speak(text: string, explanation: string, confidence = 0.8, situation: IvrDecision['situation'] = 'INFO_REQUEST'): IvrDecision {
  return { situation, action: 'SPEAK', value: text, confidence, humanLikelihood: 0, explanation };
}

/**
 * Deterministic phone-tree reasoning: general habits of a good caller, not a
 * script for any particular company. Used when Gemini is unavailable.
 */
export class RuleBasedAgent implements IvrAgent {
  readonly name = 'rules';

  async decide(input: DecisionInput): Promise<DecisionOutput> {
    return { raw: this.decideSync(input), source: 'rules' };
  }

  decideSync({ transcript: heardNow, userGoal, userContext, onHold, history }: DecisionInput): IvrDecision {
    // Prompts often arrive in pieces. If we didn't act on the previous piece, read them together.
    const previous = history.at(-1);
    const transcript = previous && previous.action?.startsWith('Waited') && !/goodbye/i.test(previous.heard) ? `${previous.heard} ${heardNow}` : heardNow;
    const options = parseMenuOptions(transcript);
    const human = scoreHumanLikelihood(transcript, { wasOnHold: onHold, musicStopped: false, previousConfidence: 0 });
    const pressedBefore = history.some((t) => t.action?.startsWith('Pressed'));
    const retrying = RETRY_HINT.test(transcript);

    if (CLOSED.test(transcript)) {
      return { situation: 'OTHER', action: 'END_CALL', value: '', confidence: 0.9, humanLikelihood: 0, explanation: "They're closed right now." };
    }

    if (VERIFY_SENSITIVE.test(transcript)) {
      return {
        situation: 'VERIFICATION',
        action: 'TRANSFER_TO_USER',
        value: '',
        confidence: 0.9,
        humanLikelihood: human.score,
        explanation: 'They are asking for security details only you can provide.',
      };
    }

    if (ACCOUNT_PROMPT.test(transcript)) {
      const known = (userContext.match(/\d[\d\s-]{5,}\d/g) ?? []).map((d) => d.replace(/\D/g, '')).sort((a, b) => b.length - a.length)[0];
      if (known) return press(known, 'Entering the account number you provided.', 0.85, 'INFO_REQUEST');
      const skip = options.find((o) => /don'?t (have|know)|skip|not sure|continue without/i.test(o.label));
      if (skip) return press(skip.key, "You didn't give an account number, so skipping that step.", 0.8, 'INFO_REQUEST');
      if (/\bsay\b.{0,30}\b(i )?don'?t know\b/i.test(transcript)) return speak("I don't know", "You didn't give an account number, so saying I don't know.");
      return wait('INFO_REQUEST', 'They want an account number you did not provide; waiting for another way through.', 0.6);
    }

    if (YES_NO.test(transcript)) {
      // The question often arrives on its own ("Is that right?"); read it with what was said just before.
      const lastHeard = history.at(-1)?.heard ?? '';
      const withContext = /calling about|is this about|did you say|this is about/i.test(transcript) ? transcript : `${lastHeard} ${transcript}`;
      const restated = withContext.match(/(?:calling about|is this about|did you say|this is about)\s+([^.?!]+)/i)?.[1] ?? withContext;
      const goalC = concepts(userGoal);
      const agree = [...concepts(restated)].some((c) => c !== 'agent' && goalC.has(c));
      const yesNo = options.find((o) => (agree ? /^yes\b/i : /^no\b/i).test(o.label));
      if (yesNo) return press(yesNo.key, agree ? 'They understood the request correctly.' : "That's not what you're calling about.", 0.85);
      return speak(agree ? 'yes' : 'no', agree ? 'They understood the request correctly.' : "That's not what you're calling about.", 0.85, 'MENU');
    }

    const offer = options.some((o) => OFFER_ACCEPT.test(o.label)) && (options.some((o) => OFFER_DECLINE.test(o.label)) || STAY_ON_LINE.test(transcript) || /\bsurvey\b/i.test(transcript));
    if (offer) {
      const decline = options.find((o) => OFFER_DECLINE.test(o.label) && !OFFER_ACCEPT.test(o.label)) ?? options.find((o) => /^no\b/i.test(o.label));
      if (decline) return press(decline.key, 'Declining the offer to keep your place in line.', 0.9, 'OTHER');
      return wait('OTHER', 'Declining the offer by staying on the line.', 0.85);
    }

    if (OPEN_PROMPT.test(transcript) && options.length === 0) {
      if (onHold) return wait('HOLD', 'An automated assistant offered help; staying in the queue for a person.', 0.8);
      const phrase = describeGoal(userGoal, retrying);
      // Don't talk over them: if we just said this and they haven't asked again, wait for their response.
      if (!retrying && history.at(-1)?.action === `Said "${phrase}"`) return wait('MENU', 'Already answered; waiting for the assistant to respond.', 0.8);
      return speak(phrase, `The assistant only understands speech, so saying "${phrase}".`, 0.85, 'MENU');
    }

    if (options.length > 0) {
      // Offers (texts, callbacks, surveys, "hear more") are never the way to a person, even when they mention your bill.
      const usable = options.filter(
        (o) => !REPEAT.test(o.label) && !NON_ENGLISH.test(o.label) && !isConsequentialOption(o.label) && !OFFER_ACCEPT.test(o.label),
      );
      const english = usable.find((o) => /\benglish\b/i.test(o.label));
      if (english && options.some((o) => NON_ENGLISH.test(o.label) || /spanish|espa/i.test(o.label))) {
        return press(english.key, 'Choosing English.', 0.95);
      }
      const ranked = rankOptions(userGoal, usable.filter((o) => !GO_BACK.test(o.label)));
      const [best, second] = ranked;
      if (best && best.score > 0) {
        const clear = !second || best.score > second.score;
        return press(best.key, `"${capitalize(best.label)}" is the closest option to your request.`, clear ? (best.score >= 2 ? 0.95 : 0.85) : 0.65);
      }
      const back = usable.find((o) => GO_BACK.test(o.label));
      if (back && pressedBefore) return press(back.key, "None of these fit, so we're probably in the wrong department. Going back.", 0.8);
      const catchAll = usable.find((o) => CATCH_ALL.test(o.label));
      if (catchAll) return press(catchAll.key, `Nothing matches exactly, so choosing "${capitalize(catchAll.label)}".`, 0.7);
      if (back) return press(back.key, 'None of these fit; starting over from the main menu.', 0.65);
      return wait('MENU', 'None of the options so far match your request; listening for more.', 0.3);
    }

    if (isHoldAnnouncement(transcript)) return wait('HOLD', 'In the hold queue; waiting for a representative.', 0.9);
    if (human.score >= 0.5) {
      return { situation: 'HUMAN', action: 'TRANSFER_TO_USER', value: '', confidence: human.score, humanLikelihood: human.score, explanation: 'A live representative appears to have answered.' };
    }
    return wait('OTHER', 'Listening for the next prompt.', 0.6, human.score);
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
