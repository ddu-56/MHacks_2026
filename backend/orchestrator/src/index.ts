import type { CallSession } from '@holdless/db';
import { DEMO_PROFILE, isTerminal, type CallStatus } from '@holdless/shared';
import { createIvrAgent } from './ai/gemini';
import { createReturnAssist } from './browser/assist';
import { mountAgentConsole } from './console/agent-console';
import { IMessageChannel } from './channels/imessage';
import { gatherContext, ManualContextProvider, type ContextProvider } from './context/provider';
import { config } from './config';
import { log } from './log';
import { CallRunner } from './runner';
import { startHttpServer } from './server';
import { SpacetimeStore } from './store/spacetime';
import { createTelephony } from './telephony';
import { openOwnChrome } from './browser/session';
import { TaskManager } from './tasks/manager';

async function main() {
  const runners = new Map<bigint, CallRunner>();
  let store: SpacetimeStore | null = null;
  let tasks: TaskManager | null = null;
  let ready = false;

  const contextProviders: ContextProvider[] = [new ManualContextProvider()];
  const telephony = await createTelephony();
  const agent = await createIvrAgent(config.gemini.apiKey, config.gemini.model, config.gemini.timeoutMs);

  const imessage = IMessageChannel.enabled()
    ? new IMessageChannel(async (req) => {
        await store!.reducers.requestCall({ ...req, source: 'imessage', demo: req.companyName === DEMO_PROFILE.companyName });
      })
    : null;

  const startCall = async (row: CallSession) => {
    if (!store || !ready || row.status !== 'REQUESTED' || runners.has(row.id)) return;
    try {
      await store.claim(row.id, telephony.name);
    } catch (err) {
      log.warn(`could not claim call ${row.id}: ${(err as Error).message}`);
      return;
    }
    const snapshot = store.getCall(row.id);
    if (!snapshot) return;
    snapshot.userContext = await gatherContext(snapshot, contextProviders);
    log.call(row.id, `claimed: ${row.companyName} — "${row.userGoal}"`);
    const runner = new CallRunner(snapshot, {
      store,
      telephony,
      agent,
      settings: config.agent,
      notify: imessage ? (id, msg) => imessage.notify(id, msg) : undefined,
      onFinished: (id) => {
        runners.delete(id);
        imessage?.release(id);
      },
    });
    runners.set(row.id, runner);
    void runner.start();
  };

  store = await SpacetimeStore.connect({
    onCallInserted: (row) => {
      if (row.source === 'imessage') imessage?.attach(row.id, row.companyName);
      void startCall(row);
    },
    onCallUpdated: (prev, next) => {
      if (!prev.cancelRequested && next.cancelRequested) void runners.get(next.id)?.cancel();
    },
    onTaskInserted: (task) => tasks?.enqueue(task),
  });
  await store.register({
    mode: telephony.name,
    demoMode: config.demoMode,
    reasoning: agent.name,
    voice: config.elevenlabs.apiKey ? 'elevenlabs' : 'none',
    demoSupportNumber: config.demo.wolverineNumber || DEMO_PROFILE.phoneNumber,
    demoUserNumber: config.demo.userPhoneNumber || (telephony.name === 'mock' ? '+15555550100' : ''),
  });
  setInterval(() => void store?.heartbeat(), 5000);
  ready = true;

  // Calls left mid-flight by a previous orchestrator process can't be resumed; close them out honestly.
  for (const row of store.allCalls()) {
    const status = row.status as CallStatus;
    if (status === 'REQUESTED') void startCall(row);
    else if (!isTerminal(status)) void store.fail(row.id, 'The call agent restarted and this call was dropped.');
  }

  // Browser agent: SpacetimeDB support_task rows (channel=browser) drive a real Chrome window.
  const taskStore = store;
  tasks = new TaskManager(taskStore, {
    baseUrl: config.browser.amazonBaseUrl,
    openSession: () => openOwnChrome(config.browser.profileDir, config.browser.channel, config.browser.headless),
    userWaitMs: config.browser.userWaitMinutes * 60_000,
    assist: await createReturnAssist(config.gemini.apiKey, config.gemini.model),
    lingerMs: 8000,
  });
  tasks.resume();
  const taskManager = tasks;

  startHttpServer({
    telephony,
    mount: (app) =>
      mountAgentConsole(app, {
        requestTask: (args) => taskStore.reducers.requestTask(args),
        approveTask: (taskId) => taskStore.reducers.approveTask({ taskId }),
        cancelTask: (taskId) => taskStore.reducers.cancelTask({ taskId }),
        tasks: () => taskStore.allTasks(),
        events: (taskId) => taskStore.taskEvents(taskId),
        artifacts: (taskId) => taskManager.artifacts.get(taskId),
      }),
  });
  if (imessage) await imessage.start().catch((err) => log.warn(`iMessage channel failed to start: ${(err as Error).message}`));
  else log.info('iMessage channel off (set PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET to enable)');
  log.info(
    `HoldLess orchestrator ready — telephony=${telephony.name} demo=${config.demoMode} reasoning=${agent.name} module=${config.spacetime.module}`,
  );
  log.info(`Browser agent console: http://localhost:${config.port}/agent (store: ${config.browser.amazonBaseUrl})`);
}

main().catch((err) => {
  log.error(err?.stack ?? String(err));
  process.exit(1);
});
