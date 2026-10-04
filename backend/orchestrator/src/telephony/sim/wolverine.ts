import type { SimCall } from './engine';

export type Difficulty = 'gentle' | 'realistic' | 'chaos';

/** How often each obstacle shows up. The caller's goal is never an input. */
export interface Profile {
  languageMenu: number;
  assistantFirst: number;
  verify: number;
  verifyHard: number;
  misroute: number;
  deflect: number;
  upsell: number;
  callbackOffer: number;
  survey: number;
  assistantDecoy: number;
  dropDuringHold: number;
  closed: number;
  busy: number;
  hesitantRep: number;
  mishear: number;
}

export const PROFILES: Record<Difficulty, Profile> = {
  gentle: { languageMenu: 0.2, assistantFirst: 0.3, verify: 0.3, verifyHard: 0, misroute: 0, deflect: 0.3, upsell: 0.2, callbackOffer: 0.3, survey: 0.2, assistantDecoy: 0.2, dropDuringHold: 0, closed: 0, busy: 0, hesitantRep: 0.2, mishear: 0.03 },
  realistic: { languageMenu: 0.5, assistantFirst: 0.6, verify: 0.6, verifyHard: 0, misroute: 0.3, deflect: 0.5, upsell: 0.4, callbackOffer: 0.5, survey: 0.3, assistantDecoy: 0.4, dropDuringHold: 0.15, closed: 0, busy: 0, hesitantRep: 0.35, mishear: 0.12 },
  chaos: { languageMenu: 0.7, assistantFirst: 0.7, verify: 0.8, verifyHard: 0.3, misroute: 0.5, deflect: 0.7, upsell: 0.7, callbackOffer: 0.7, survey: 0.6, assistantDecoy: 0.6, dropDuringHold: 0.35, closed: 0.1, busy: 0.1, hesitantRep: 0.5, mishear: 0.2 },
};

/** What actually happened on the call, for tests and logs. */
export interface Outcome {
  path: string[];
  reachedHuman: boolean;
  department: '' | 'billing' | 'tech' | 'sales' | 'general';
  boughtUpsell: boolean;
  tookCallback: boolean;
  tookTextLink: boolean;
  surveyYes: boolean;
  gaveSsnDigits: boolean;
  endedBy: '' | 'company-hangup' | 'dropped' | 'closed' | 'busy';
}

export function newOutcome(): Outcome {
  return { path: [], reachedHuman: false, department: '', boughtUpsell: false, tookCallback: false, tookTextLink: false, surveyYes: false, gaveSsnDigits: false, endedBy: '' };
}

type Dept = 'billing' | 'tech' | 'sales' | 'stores' | 'general';

// The company's speech recognizer: broad, like real NLU — not tuned to any caller.
const SAY_BILLING = /\b(bill|billing|charge[ds]?|payment|pay|refund|dispute|statement|overcharg\w*|fee|invoice|account balance|money|credit)\b/i;
const SAY_TECH = /\b(internet|outage|signal|wifi|not working|broken|technical|tech|device|service is down|connection)\b/i;
const SAY_SALES = /\b(plan|upgrade|new (phone|line)|buy|switch|deal|offer)\b/i;
const SAY_AGENT = /\b(agent|representative|human|person|operator|someone|real person|customer service)\b/i;
const SAY_YES = /^\W*(yes|yeah|yep|yup|correct|that'?s right|right|sure|affirmative)\b/i;
const SAY_NO = /^\W*(no|nope|nah|not really|wrong|incorrect)\b/i;
const SAY_DONT_KNOW = /\b(don'?t know|do not know|not sure|don'?t have|do not have|skip)\b/i;

interface Options {
  holdSeconds: number;
  announceSeconds: number;
  profile: Profile;
  outcome: Outcome;
}

/**
 * Wolverine Wireless, as a realistic, slightly hostile phone system. Every call
 * rolls its own variant: wording, menu order, which obstacles appear.
 */
export async function wolverineScenario(call: SimCall, o: Options) {
  const { rng } = call;
  const p = o.profile;
  const out = o.outcome;
  const step = (s: string) => out.path.push(s);

  await call.pause(rng.between(0.4, 1.2));
  await call.say(
    rng.pick([
      'Thank you for calling Wolverine Wireless.',
      "Hi, and thanks for calling Wolverine Wireless, where you're always connected.",
      'Welcome to Wolverine Wireless customer care.',
    ]),
  );

  if (rng.chance(p.closed)) {
    step('closed');
    out.endedBy = 'closed';
    await call.hangup(
      'Our offices are currently closed. Our hours are 8 AM to 8 PM Eastern, Monday through Saturday. Please call back during those hours. Goodbye.',
      'closed',
    );
  }

  await call.say(
    rng.pick([
      'This call may be monitored or recorded for quality assurance.',
      'Please note that calls may be recorded for training purposes.',
    ]),
    rng.between(0.3, 1),
  );
  if (rng.chance(0.5)) {
    await call.say(
      rng.pick([
        'Did you know you can pay your bill, check your data, and upgrade your phone anytime in the Wolverine app?',
        "We're currently experiencing higher than normal call volumes. Your patience is appreciated.",
      ]),
      rng.between(0.5, 1.5),
    );
  }

  if (rng.chance(p.languageMenu)) {
    step('language');
    const lang = await call.menu({
      prompt: 'For English, press 1. Para español, oprima el dos.',
      options: [
        { keys: ['1'], speech: /english/i, value: 'en' },
        { keys: ['2'], speech: /espa(n|ñ)ol|spanish/i, value: 'es' },
      ],
      onSilence: 'en',
    });
    if (lang === 'es') {
      step('spanish');
      await call.say('Lo sentimos, este servicio no está disponible en este momento. Continuing in English.');
    }
  }

  // Main routing: a talk-to-me assistant or a keypad menu, sometimes both.
  let dept: Dept | null = null;
  if (rng.chance(p.assistantFirst)) {
    step('assistant');
    dept = await assistantRouting(call, out);
  }
  let misrouteAvailable = rng.chance(p.misroute);
  for (let rounds = 0; dept === null || dept === 'stores'; rounds++) {
    if (rounds > 3) await call.hangup("We're unable to complete your request. Please try again later. Goodbye.");
    if (dept === 'stores') {
      step('stores');
      await call.say('Our stores are open 10 AM to 8 PM daily. To find a store near you, visit wolverine wireless dot com slash stores.');
    }
    dept = await mainMenu(call, out);
  }

  if (rng.chance(p.verify)) await verification(call, out, rng.chance(p.verifyHard));

  if (dept === 'billing') {
    for (;;) {
      const choice = await billingMenu(call, out);
      if (choice === 'main') {
        dept = await mainMenu(call, out);
        if (dept !== 'billing') break;
        continue;
      }
      if (choice === 'payments') {
        step('payments');
        await call.say(
          "Your balance is 84 dollars and 17 cents, due on October 21st. To pay now with the card on file, press 1. To return to the billing menu, press 2.",
        );
        const pay = await call.menu({
          prompt: 'Press 1 to pay now, or 2 to go back.',
          options: [
            { keys: ['1'], value: 'pay' },
            { keys: ['2'], speech: /back|no|return|menu/i, value: 'back' },
          ],
          onSilence: 'back',
        });
        if (pay === 'pay') await call.say('Payment features are unavailable right now.');
        continue;
      }
      if (choice === 'paperless') {
        step('paperless');
        await call.say('To update your billing address or go paperless, visit My Wolverine online. Returning to the billing menu.');
        continue;
      }
      // "Statement / recent activity": the right place — unless the transfer goes wrong.
      if (misrouteAvailable) {
        misrouteAvailable = false;
        step('misrouted-to-tech');
        await call.say('Please hold while I transfer you.', 1.5);
        const back = await techMenu(call, out);
        if (back === 'main') {
          dept = await mainMenu(call, out);
          if (dept === 'billing') continue;
        } else dept = 'tech';
      }
      break;
    }
  }

  if (dept === 'billing' && rng.chance(p.deflect)) await deflection(call, out);
  if (rng.chance(p.upsell)) await upsell(call, out);

  await hold(call, o, dept ?? 'general');
}

async function assistantRouting(call: SimCall, out: Outcome): Promise<Dept | null> {
  const { rng } = call;
  for (let tries = 0; tries < 2; tries++) {
    const heard = await call.menu<Dept | 'agent' | 'unknown'>({
      prompt: (attempt) =>
        attempt === 0 && tries === 0
          ? rng.pick([
              "Hi, I'm Ava, Wolverine's virtual assistant. In a few words, tell me why you're calling. You can say things like pay my bill, report an outage, or something else.",
              "I'm Wolverine's automated assistant. Briefly tell me what you're calling about today.",
            ])
          : 'Please tell me, in just a few words, what you need help with.',
      speechOnly: true,
      options: [
        { speech: SAY_BILLING, value: 'billing' },
        { speech: SAY_TECH, value: 'tech' },
        { speech: SAY_SALES, value: 'sales' },
        { speech: SAY_AGENT, value: 'agent' },
        { speech: /something else|other|none/i, value: 'unknown' },
      ],
      onGiveUp: 'unknown',
      attempts: 2,
    });
    if (heard === 'unknown') return null;
    if (heard === 'agent') {
      out.path.push('asked-for-agent');
      await call.say("I can get you to a representative. First, so I can send you to the right team, what's it about?");
      continue;
    }
    const restated = { billing: 'a question about your bill', tech: 'a problem with your service', sales: 'a new plan or phone', stores: 'store hours', general: 'something else' }[heard];
    const ok = await call.menu({
      prompt: `It sounds like you're calling about ${restated}. Is that right?`,
      options: [
        { keys: ['1'], speech: SAY_YES, value: true },
        { keys: ['2'], speech: SAY_NO, value: false },
      ],
      attempts: 2,
      onGiveUp: false,
    });
    if (ok) {
      out.path.push(`assistant:${heard}`);
      return heard;
    }
    await call.say("Okay, let's try that again.");
  }
  await call.say("Let's try this a different way.");
  return null;
}

async function mainMenu(call: SimCall, out: Outcome): Promise<Dept> {
  const { rng } = call;
  out.path.push('main-menu');
  const items = rng.shuffle([
    { label: rng.pick(['For account and billing', 'For questions about your bill or account', 'For billing, payments, and your account']), dept: 'billing' as Dept },
    { label: rng.pick(['For help with your device or service', 'For technical support', 'If your phone or service is not working']), dept: 'tech' as Dept },
    { label: rng.pick(['For plans, upgrades, or a new line', 'To shop for a new phone or plan']), dept: 'sales' as Dept },
    { label: 'For store hours and locations', dept: 'stores' as Dept },
  ]);
  const keyed = items.map((it, i) => ({ ...it, key: String(i + 1) }));
  const other = String(keyed.length + 1);
  const prompt = `${keyed.map((k) => `${k.label}, press ${k.key}.`).join(' ')} For anything else, press ${other}. To hear these options again, press 9.`;
  for (;;) {
    const v = await call.menu<Dept | 'repeat'>({
      prompt,
      options: [
        ...keyed.map((k) => ({ keys: [k.key], value: k.dept })),
        { keys: [other], speech: /something else|other|agent|representative/i, value: 'general' as Dept },
        { keys: ['9'], value: 'repeat' as const },
      ],
    });
    if (v !== 'repeat') {
      out.path.push(`main:${v}`);
      return v;
    }
  }
}

async function billingMenu(call: SimCall, out: Outcome): Promise<'payments' | 'activity' | 'paperless' | 'main'> {
  const { rng } = call;
  out.path.push('billing-menu');
  const items = rng.shuffle([
    { label: rng.pick(['To hear your balance or make a payment', 'For payments and balance information', 'To pay your bill']), v: 'payments' as const },
    {
      label: rng.pick(['For questions about your statement or recent activity', 'If something on your bill does not look right', 'To ask about a charge on your bill']),
      v: 'activity' as const,
    },
    { label: rng.pick(['To update your billing address or go paperless', 'For paperless billing and address changes']), v: 'paperless' as const },
  ]);
  const keyed = items.map((it, i) => ({ ...it, key: String(i + 1) }));
  const prompt = `${rng.pick(['Billing.', 'You have reached billing.', 'Okay, billing.'])} ${keyed.map((k) => `${k.label}, press ${k.key}.`).join(' ')} To return to the main menu, press star.`;
  const v = await call.menu<'payments' | 'activity' | 'paperless' | 'main'>({
    prompt,
    options: [...keyed.map((k) => ({ keys: [k.key], value: k.v })), { keys: ['*'], speech: /main menu|go back|start over/i, value: 'main' as const }],
  });
  out.path.push(`billing:${v}`);
  return v;
}

async function techMenu(call: SimCall, out: Outcome): Promise<'main' | 'tech'> {
  out.path.push('tech-menu');
  const v = await call.menu<'main' | 'tech'>({
    prompt:
      'Welcome to Wolverine technical support. For help with your home internet, press 1. For help with your phone or device, press 2. For all other technical questions, press 3. To go back to the main menu, press 9.',
    options: [
      { keys: ['1', '2', '3'], value: 'tech' },
      { keys: ['9'], speech: /main menu|go back|billing/i, value: 'main' },
    ],
  });
  out.path.push(`tech:${v}`);
  return v;
}

async function verification(call: SimCall, out: Outcome, hard: boolean) {
  const { rng } = call;
  if (hard) {
    out.path.push('verify-ssn');
    for (let i = 0; i < 2; i++) {
      await call.say("For your security, please enter the last four digits of the account holder's Social Security number.", 0.2);
      const got = await call.listen(9);
      if (got?.type === 'digits' && got.value.length === 4) {
        out.gaveSsnDigits = true;
        await call.say('Thank you.');
        return;
      }
    }
    out.endedBy = 'company-hangup';
    await call.hangup("I'm sorry, I can't continue without verifying your identity. Goodbye.");
  }
  out.path.push('verify-account');
  const skippable = rng.chance(0.7);
  for (let i = 0; i < 3; i++) {
    await call.say(
      `To help us find your account, please enter or say your 10 digit account number. ${skippable ? "If you don't have it, press star." : "If you don't know it, just say I don't know."}`,
      0.2,
    );
    const got = await call.listen(9);
    if (!got) {
      if (i < 2) await call.say("I didn't get that.");
      continue;
    }
    if (got.type === 'digits' && got.value.replace(/[#*]/g, '').length === 10) {
      await call.say('Thanks, I found your account.');
      return;
    }
    if ((got.type === 'digits' && got.value === '*' && skippable) || (got.type === 'speech' && SAY_DONT_KNOW.test(got.text))) {
      await call.say("No problem, we'll look you up later.");
      return;
    }
    if (got.type === 'digits') await call.say("That account number doesn't match our records.");
    else await call.say("Sorry, I didn't catch that number.");
  }
  await call.say("Let's continue without it.");
}

async function deflection(call: SimCall, out: Outcome) {
  out.path.push('deflection');
  const v = await call.menu({
    prompt:
      'Did you know most billing questions can be answered in the Wolverine app? To get a text message with a link to your bill, press 1. To keep holding for a billing specialist, press 2.',
    options: [
      { keys: ['1'], speech: /text|link|app/i, value: 'text' },
      { keys: ['2'], speech: /hold|specialist|agent|representative|person|no/i, value: 'hold' },
    ],
    onSilence: 'hold',
  });
  if (v === 'text') {
    out.tookTextLink = true;
    out.endedBy = 'company-hangup';
    await call.hangup("Great, we've sent you a text with a link. Thanks for calling Wolverine Wireless. Goodbye.");
  }
}

async function upsell(call: SimCall, out: Outcome) {
  out.path.push('upsell');
  const v = await call.menu({
    prompt: 'Good news! Your line qualifies for Unlimited Plus with 5G hotspot for only 10 dollars more per month. To hear more about this offer, press 1. Otherwise, please stay on the line.',
    options: [{ keys: ['1'], speech: /yes|hear more|tell me/i, value: 'more' }],
    onSilence: 'skip',
    waitSeconds: 5,
  });
  if (v !== 'more') return;
  await call.say('Unlimited Plus includes premium 5G data, 50 gigabytes of hotspot, and HD streaming.');
  const buy = await call.menu({
    prompt: 'To add Unlimited Plus to your account today, press 1. To go back, press 2.',
    options: [
      { keys: ['1'], speech: /yes|add|sign me up/i, value: 'buy' },
      { keys: ['2'], speech: /no|back|not interested/i, value: 'back' },
    ],
    onSilence: 'back',
  });
  if (buy === 'buy') {
    out.boughtUpsell = true;
    await call.say('Unlimited Plus has been added to your account, effective your next bill.');
  }
}

async function hold(call: SimCall, o: Options, dept: Dept) {
  const { rng } = call;
  const p = o.profile;
  const out = o.outcome;
  out.path.push(`hold:${dept}`);
  const teamName = dept === 'billing' ? 'billing specialist' : dept === 'tech' ? 'technical support agent' : 'representative';
  await call.say(
    rng.pick([`Please hold while we connect you to the next available ${teamName}.`, `All of our ${teamName}s are currently assisting other customers. Please stay on the line.`]),
  );
  const total = o.holdSeconds * rng.between(0.7, 1.4);
  const willDrop = rng.chance(p.dropDuringHold);
  const dropAt = total * rng.between(0.3, 0.7);
  const events = rng.shuffle(
    [
      rng.chance(p.callbackOffer) && ('callback' as const),
      rng.chance(p.survey) && ('survey' as const),
      rng.chance(p.assistantDecoy) && ('decoy' as const),
      'announce' as const,
    ].filter(Boolean) as Array<'callback' | 'survey' | 'decoy' | 'announce'>,
  );
  const slice = total / (events.length + 1);
  let elapsed = 0;
  call.music(true);
  for (const ev of events) {
    await call.pause(slice);
    elapsed += slice;
    if (willDrop && elapsed >= dropAt) {
      out.endedBy = 'dropped';
      call.drop();
    }
    call.music(false);
    await holdEvent(call, out, ev, rng.between(4, 18));
    call.music(true);
  }
  await call.pause(slice);
  if (willDrop) {
    out.endedBy = 'dropped';
    call.drop();
  }
  call.music(false);
  await call.pause(rng.between(0.4, 1.5));
  await representative(call, out, dept === 'stores' ? 'general' : dept, rng.chance(p.hesitantRep));
}

async function holdEvent(call: SimCall, out: Outcome, ev: 'callback' | 'survey' | 'decoy' | 'announce', minutes: number) {
  const { rng } = call;
  if (ev === 'announce') {
    await call.say(
      rng.pick([
        'Your call is important to us. Please continue to hold and the next available representative will be with you shortly.',
        'Thank you for your patience. All of our representatives are still assisting other customers.',
        `Your estimated wait time is approximately ${Math.round(minutes)} minutes.`,
      ]),
    );
    return;
  }
  if (ev === 'callback') {
    out.path.push('callback-offer');
    const v = await call.menu({
      prompt: `Your estimated wait time is about ${Math.round(minutes)} minutes. If you'd like us to call you back instead, press 1. To keep holding, stay on the line.`,
      options: [{ keys: ['1'], speech: /call ?back|yes/i, value: 'callback' }],
      onSilence: 'hold',
      waitSeconds: 5,
    });
    if (v === 'callback') {
      out.tookCallback = true;
      out.endedBy = 'company-hangup';
      await call.hangup("We'll call you back at the number you're calling from when it's your turn. Goodbye.");
    }
    return;
  }
  if (ev === 'survey') {
    out.path.push('survey-offer');
    const v = await call.menu({
      prompt: 'Would you like to take a short survey after your call? Press 1 for yes, or 2 for no.',
      options: [
        { keys: ['1'], speech: SAY_YES, value: true },
        { keys: ['2'], speech: SAY_NO, value: false },
      ],
      onSilence: false,
      waitSeconds: 5,
    });
    out.surveyYes = v;
    await call.say(v ? "Great, we'll connect you to the survey after your call." : 'Okay.');
    return;
  }
  // A cheerful virtual assistant that introduces itself by name — not a person.
  out.path.push('assistant-decoy');
  const v = await call.menu({
    prompt: rng.pick([
      "Hi there! I'm Ava, Wolverine's virtual assistant. While you wait, I can help with your bill right now. Just tell me what you need.",
      "Hello! This is Max, your Wolverine digital assistant. How can I help you while you wait?",
    ]),
    options: [{ speech: /.+/, value: 'spoke' }],
    onSilence: 'silent',
    waitSeconds: 5,
  });
  await call.say(v === 'spoke' ? "I'm not able to help with that here. I'll keep your place in line." : "No problem, I'll keep your place in line.");
}

async function representative(call: SimCall, out: Outcome, dept: Dept, hesitant: boolean) {
  const { rng } = call;
  out.reachedHuman = true;
  out.department = dept === 'stores' ? 'general' : dept;
  out.path.push('human');
  call.humanAnswered();
  const team = dept === 'billing' ? 'billing' : dept === 'tech' ? 'technical support' : dept === 'sales' ? 'sales' : 'customer care';
  const name = rng.pick(['Marcus', 'Priya', 'Dana', 'Luis', 'Keisha', 'Sam']);
  if (hesitant) {
    await call.say('Hello?', 2.5);
    await call.say(`Hi, sorry, I think we had a bad connection there. This is ${name} in ${team}, how can I help?`);
  } else {
    await call.say(
      rng.pick([
        `Hi, thanks for holding. This is ${name} with Wolverine ${team}. Who do I have the pleasure of speaking with?`,
        `Wolverine Wireless ${team}, my name is ${name}. Sorry about the wait! What can I do for you today?`,
        `Thank you for holding, you've reached ${team}. I'm ${name}. How can I help you?`,
      ]),
    );
  }
  // Nobody answers back: a real person eventually gives up.
  if (!(await call.listen(15))) await call.say('Hello? Are you still there?');
  if (!(await call.listen(20))) await call.hangup("I'm not hearing anything, so I'm going to disconnect. Please call us back. Goodbye.");
}
