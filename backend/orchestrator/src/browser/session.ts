import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { AgentStop } from './amazon-return';

/** A tab the agent may drive, and how to let go of it afterwards. */
export interface BrowserSession {
  page: Page;
  close(): Promise<void>;
}

/** HoldLess's own Chrome window with a dedicated profile (sign in there once). */
export async function openOwnChrome(profileDir: string, channel: string, headless: boolean): Promise<BrowserSession> {
  const { chromium } = await import('playwright');
  fs.mkdirSync(profileDir, { recursive: true });
  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: channel || undefined,
      headless,
      viewport: headless ? { width: 1280, height: 900 } : null,
      args: ['--window-size=1280,900'],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return { page, close: () => context.close().catch(() => {}) };
  } catch (err) {
    const msg = (err as Error).message;
    if (/ProcessSingleton|SingletonLock|profile.*in use/i.test(msg)) {
      throw new AgentStop('The HoldLess Chrome window from a previous task is still open. Close it and try again.');
    }
    if (/Executable doesn't exist|not found|chrome.*not installed/i.test(msg)) {
      throw new AgentStop('Google Chrome was not found. Install Chrome, or set BROWSER_CHANNEL= and run `npx playwright install chromium`.');
    }
    throw err;
  }
}
