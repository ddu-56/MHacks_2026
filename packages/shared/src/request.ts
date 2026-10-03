import { DEMO_PROFILE } from './wolverine';

export interface ParsedRequest {
  companyName: string;
  userGoal: string;
}

/**
 * Cheap deterministic parse of "Get me a human at <Company> about <goal>".
 * The orchestrator tries Gemini first for free-form text and falls back to this.
 */
export function parseRequestText(text: string): ParsedRequest | null {
  const clean = text.trim().replace(/[.!?]+$/, '');
  const m =
    clean.match(/\b(?:at|call|with|reach|from)\s+(.+?)\s+(?:about|regarding|re:|for|and get me to\s+.+?\s+about)\s+(.+)$/i) ??
    clean.match(/^(.+?)\s+(?:about|regarding)\s+(.+)$/i);
  if (!m) return null;
  const companyName = m[1]!.replace(/^(?:the)\s+/i, '').replace(/\s+(?:customer service|support|billing)$/i, '').trim();
  const goalCore = m[2]!.trim();
  if (!companyName || !goalCore) return null;
  return { companyName, userGoal: `Talk to someone about ${goalCore.replace(/^(?:my|an?|the)\s+/i, (w) => w.toLowerCase())}.` };
}

/** Only fictional demo companies are dialable without an explicit number. */
export const COMPANY_DIRECTORY: Record<string, { displayName: string; phoneNumber: string }> = {
  'wolverine wireless': { displayName: DEMO_PROFILE.companyName, phoneNumber: DEMO_PROFILE.phoneNumber },
};

export function lookupCompany(name: string) {
  return COMPANY_DIRECTORY[name.trim().toLowerCase()] ?? null;
}
