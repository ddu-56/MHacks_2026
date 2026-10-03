import { DEMO_PROFILE, lookupCompany, parseRequestText } from '@holdless/shared';
import { config } from '../config';
import { log } from '../log';

interface SpaceLike {
  send(content: string): Promise<unknown>;
}

export interface RequestCallFn {
  (req: { companyName: string; phoneNumber: string; userGoal: string; userPhoneNumber: string; userContext: string }): Promise<void>;
}

const PHONE_RE = /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;

/**
 * iMessage front door via Photon Spectrum. Texts like "Get me billing at
 * Wolverine Wireless about my incorrect charge" become SpacetimeDB call
 * requests; call milestones are texted back to the same conversation.
 */
export class IMessageChannel {
  private pending: Array<{ key: string; space: SpaceLike }> = [];
  private spaces = new Map<bigint, SpaceLike>();

  constructor(private readonly requestCall: RequestCallFn) {}

  static enabled() {
    return !!(config.photon.projectId && config.photon.projectSecret);
  }

  async start() {
    const { Spectrum } = await import('spectrum-ts');
    const { imessage } = await import('spectrum-ts/providers/imessage');
    const app = await Spectrum({
      projectId: config.photon.projectId,
      projectSecret: config.photon.projectSecret,
      providers: [imessage.config()],
    });
    log.info('iMessage (Photon Spectrum) channel online');
    void (async () => {
      for await (const [space, message] of app.messages) {
        if (message.direction !== 'inbound' || message.content.type !== 'text') continue;
        await this.handle(space as SpaceLike, message.content.text, message.sender?.id ?? '').catch((err) =>
          log.warn(`iMessage handling failed: ${(err as Error).message}`),
        );
      }
    })();
  }

  private async handle(space: SpaceLike, text: string, senderId: string) {
    const parsed = parseRequestText(text);
    if (!parsed) {
      await space.send('Tell me who to call and why, e.g. "Get me a human at Wolverine Wireless about an incorrect charge."');
      return;
    }
    const known = lookupCompany(parsed.companyName);
    const explicitNumber = text.match(PHONE_RE)?.[1];
    const phoneNumber =
      known?.displayName === DEMO_PROFILE.companyName ? config.demo.wolverineNumber || known.phoneNumber : explicitNumber ?? known?.phoneNumber;
    if (!phoneNumber) {
      await space.send(`I don't have a number for ${parsed.companyName}. Text it again with their support number.`);
      return;
    }
    const userPhoneNumber = /^\+?\d{10,15}$/.test(senderId) ? senderId : config.demo.userPhoneNumber;
    if (!userPhoneNumber) {
      await space.send("I need a number to call you back on. Set USER_PHONE_NUMBER on the server.");
      return;
    }
    const companyName = known?.displayName ?? parsed.companyName;
    this.pending.push({ key: companyName.toLowerCase(), space });
    await this.requestCall({
      companyName,
      phoneNumber,
      userGoal: parsed.userGoal,
      userPhoneNumber,
      userContext: known?.displayName === DEMO_PROFILE.companyName ? DEMO_PROFILE.userContext : '',
    });
  }

  /** Called when SpacetimeDB reports a new call row created from iMessage. */
  attach(callId: bigint, companyName: string) {
    const idx = this.pending.findIndex((p) => p.key === companyName.toLowerCase());
    if (idx === -1) return;
    const space = this.pending.splice(idx, 1)[0]!.space;
    this.spaces.set(callId, space);
    if (config.webBaseUrl) void space.send(`Watch it live: ${config.webBaseUrl}/calls/${callId}`).catch(() => {});
  }

  notify(callId: bigint, message: string) {
    const space = this.spaces.get(callId);
    if (space) void space.send(message).catch((err) => log.warn(`iMessage send failed: ${(err as Error).message}`));
  }

  release(callId: bigint) {
    this.spaces.delete(callId);
  }
}
