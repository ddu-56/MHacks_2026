export interface AgentTurn {
  heard: string;
  action?: string;
}

export interface DecisionInput {
  companyName: string;
  userGoal: string;
  userContext: string;
  /** The complete utterance just heard from the company side. */
  transcript: string;
  onHold: boolean;
  history: AgentTurn[];
}

export interface DecisionOutput {
  /** Unvalidated model output. Always passed through validateDecision before use. */
  raw: unknown;
  source: 'gemini' | 'rules';
  note?: string;
}

export interface IvrAgent {
  readonly name: string;
  decide(input: DecisionInput): Promise<DecisionOutput>;
}
