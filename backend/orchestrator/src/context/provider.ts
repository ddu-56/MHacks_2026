import type { CallSnapshot } from '../store/types';

export interface ContextItem {
  source: string;
  label: string;
  value: string;
}

/**
 * Supplies details the agent may share with an automated system (never with a
 * human, never credentials). Gmail, calendar or document providers plug in here.
 */
export interface ContextProvider {
  readonly name: string;
  gather(call: CallSnapshot): Promise<ContextItem[]>;
}

/** Details the user typed into the request form (stored in SpacetimeDB's user_context table). */
export class ManualContextProvider implements ContextProvider {
  readonly name = 'manual';
  async gather(call: CallSnapshot): Promise<ContextItem[]> {
    return call.userContext ? [{ source: 'manual', label: 'Details you provided', value: call.userContext }] : [];
  }
}

export async function gatherContext(call: CallSnapshot, providers: ContextProvider[]): Promise<string> {
  const results = await Promise.allSettled(providers.map((p) => p.gather(call)));
  return results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .map((c) => c.value)
    .join('\n');
}
