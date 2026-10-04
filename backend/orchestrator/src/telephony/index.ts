import { config } from '../config';
import { log } from '../log';
import { MockTelephony } from './mock';
import type { TelephonyProvider } from './types';

function requireTwilioConfig(mode: string) {
  const missing = [
    ['TWILIO_ACCOUNT_SID', config.twilio.accountSid],
    ['TWILIO_AUTH_TOKEN', config.twilio.authToken],
    ['TWILIO_PHONE_NUMBER', config.twilio.phoneNumber],
    ['PUBLIC_BASE_URL', config.publicBaseUrl],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`TELEPHONY_MODE=${mode} needs ${missing.join(', ')} in .env`);
}

export async function createTelephony(): Promise<TelephonyProvider> {
  const mock = () =>
    new MockTelephony({
      holdSeconds: config.demo.holdSeconds,
      holdAnnouncementSeconds: config.demo.holdAnnouncementSeconds,
      scenario: config.mock.scenario,
      seed: config.mock.seed,
    });

  if (config.telephonyMode === 'twilio') {
    requireTwilioConfig('twilio');
    const { TwilioTelephony } = await import('./twilio');
    return new TwilioTelephony();
  }
  if (config.telephonyMode === 'hybrid') {
    requireTwilioConfig('hybrid');
    const [{ TwilioTelephony }, { HybridTelephony }] = await Promise.all([import('./twilio'), import('./hybrid')]);
    log.warn(
      `TELEPHONY_MODE=hybrid — company line SIMULATED; real Twilio calls to the user${
        config.demo.repPhoneNumber ? ' and the teammate rep' : ' (rep voice: scripted "Sarah")'
      }`,
    );
    return new HybridTelephony(mock(), new TwilioTelephony(), config.demo.repPhoneNumber);
  }
  log.warn(`TELEPHONY_MODE=mock — calls are SIMULATED in-process (scenario: ${config.mock.scenario}${config.mock.seed !== undefined ? `, seed ${config.mock.seed}` : ''})`);
  return mock();
}
