/**
 * Wolverine Wireless: the fake carrier used for the stage demo. The same script
 * drives the in-process mock IVR and the Twilio-hosted IVR, so mock and live
 * runs exercise identical menus.
 */

export interface IvrOption {
  key: string;
  label: string;
  next: string;
}

export interface IvrNode {
  id: string;
  kind: 'menu' | 'hold' | 'info';
  prompt: string;
  options: IvrOption[];
}

export const WOLVERINE_GREETING = 'Thank you for calling Wolverine Wireless.';

export const WOLVERINE_IVR: Record<string, IvrNode> = {
  main: {
    id: 'main',
    kind: 'menu',
    prompt: 'For sales, press 1. For technical support, press 2. For billing, press 3.',
    options: [
      { key: '1', label: 'Sales', next: 'sales' },
      { key: '2', label: 'Technical support', next: 'hold' },
      { key: '3', label: 'Billing', next: 'billing' },
    ],
  },
  sales: {
    id: 'sales',
    kind: 'info',
    prompt: 'Our sales team is currently closed. To return to the main menu, press 9.',
    options: [{ key: '9', label: 'Main menu', next: 'main' }],
  },
  billing: {
    id: 'billing',
    kind: 'menu',
    prompt:
      'Billing. For making a payment, press 1. To dispute a charge, press 2. For all other billing questions, press 3.',
    options: [
      { key: '1', label: 'Make a payment', next: 'payment' },
      { key: '2', label: 'Dispute a charge', next: 'hold' },
      { key: '3', label: 'Other billing questions', next: 'hold' },
    ],
  },
  payment: {
    id: 'payment',
    kind: 'info',
    prompt: 'Our automated payment system is unavailable. To return to the main menu, press 9.',
    options: [{ key: '9', label: 'Main menu', next: 'main' }],
  },
  hold: {
    id: 'hold',
    kind: 'hold',
    prompt: 'Please hold while we connect you to the next available representative.',
    options: [],
  },
};

export const WOLVERINE_HOLD_ANNOUNCEMENTS = [
  'Your call is important to us. Please stay on the line and the next available representative will be with you shortly.',
  'Thank you for your patience. All of our representatives are currently assisting other customers. Please continue to hold.',
];

export const WOLVERINE_INVALID = "Sorry, I didn't get that.";

/** Line the simulated representative says when no teammate is answering. */
export const WOLVERINE_REP_GREETING =
  'Hi, thanks for holding. My name is Sarah with Wolverine Wireless billing. How can I help you today?';

export const DEMO_PROFILE = {
  companyName: 'Wolverine Wireless',
  /** Fictional; the Twilio-hosted IVR number comes from WOLVERINE_IVR_NUMBER. */
  phoneNumber: '+17345550142',
  userGoal: 'Talk to someone about an incorrect $40 charge.',
  userContext:
    'Account holder: Alex Rivera. There is a $40 "Premium Data Add-on" charge on my September bill that I never ordered.',
} as const;

export function ivrPromptFor(nodeId: string, withGreeting = false): string {
  const node = WOLVERINE_IVR[nodeId];
  if (!node) throw new Error(`Unknown IVR node ${nodeId}`);
  return withGreeting ? `${WOLVERINE_GREETING} ${node.prompt}` : node.prompt;
}
