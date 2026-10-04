import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, type Timestamp } from 'spacetimedb';
import { canTransition, isCallStatus, isTerminal, type CallStatus } from '../../../packages/shared/src/states.ts';
import {
  canTaskTransition,
  isTaskChannel,
  isTaskStatus,
  isTaskTerminal,
  type TaskStatus,
} from '../../../packages/shared/src/tasks.ts';

const callSession = table(
  { name: 'call_session', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    userId: t.string(),
    companyName: t.string(),
    phoneNumber: t.string(),
    userGoal: t.string(),
    userPhoneNumber: t.string(),
    status: t.string(),
    currentMenuContext: t.string(),
    lastActionSummary: t.string(),
    humanConfidence: t.f64(),
    errorMessage: t.string(),
    mode: t.string(),
    source: t.string(),
    demo: t.bool(),
    cancelRequested: t.bool(),
    supportCallSid: t.string(),
    userCallSid: t.string(),
    startedAt: t.timestamp(),
    updatedAt: t.timestamp(),
    holdStartedAt: t.option(t.timestamp()),
    humanDetectedAt: t.option(t.timestamp()),
    connectedAt: t.option(t.timestamp()),
    endedAt: t.option(t.timestamp()),
  },
);

const callEvent = table(
  { name: 'call_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index('btree'),
    timestamp: t.timestamp(),
    type: t.string(),
    actor: t.string(),
    title: t.string(),
    description: t.string(),
    metadata: t.string(),
    dedupeKey: t.string().index('btree'),
  },
);

const transcriptSegment = table(
  { name: 'transcript_segment', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index('btree'),
    speakerType: t.string(),
    text: t.string(),
    confidence: t.f64(),
    createdAt: t.timestamp(),
  },
);

const callAction = table(
  { name: 'call_action', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index('btree'),
    actionType: t.string(),
    reasoningSummary: t.string(),
    actionValue: t.string(),
    confidence: t.f64(),
    status: t.string(),
    timestamp: t.timestamp(),
  },
);

const agentStatus = table(
  { name: 'agent_status', public: true },
  {
    callId: t.u64().primaryKey(),
    agentName: t.string(),
    status: t.string(),
    currentTask: t.string(),
    updatedAt: t.timestamp(),
  },
);

const userContext = table(
  { name: 'user_context', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index('btree'),
    source: t.string(),
    label: t.string(),
    value: t.string(),
  },
);

/** Singleton row describing the call orchestrator (the only identity allowed to drive calls). */
const orchestrator = table(
  { name: 'orchestrator', public: true },
  {
    id: t.u32().primaryKey(),
    identity: t.identity(),
    mode: t.string(),
    demoMode: t.bool(),
    reasoning: t.string(),
    voice: t.string(),
    demoSupportNumber: t.string(),
    demoUserNumber: t.string(),
    version: t.string(),
    lastHeartbeat: t.timestamp(),
  },
);

/** A non-phone support task (browser agent, email ticket). Phone tasks keep using call_session. */
const supportTask = table(
  { name: 'support_task', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    userId: t.string(),
    channel: t.string(),
    provider: t.string(),
    query: t.string(),
    paramsJson: t.string(),
    status: t.string(),
    step: t.string(),
    summary: t.string(),
    result: t.string(),
    errorMessage: t.string(),
    approveRequested: t.bool(),
    cancelRequested: t.bool(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
  },
);

const taskEvent = table(
  { name: 'task_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    taskId: t.u64().index('btree'),
    timestamp: t.timestamp(),
    kind: t.string(),
    title: t.string(),
    description: t.string(),
  },
);

const watchdogTimer = table(
  { name: 'watchdog_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);

const spacetimedb = schema({
  callSession,
  callEvent,
  transcriptSegment,
  callAction,
  agentStatus,
  userContext,
  orchestrator,
  supportTask,
  taskEvent,
  watchdogTimer,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type CallRow = NonNullable<ReturnType<Ctx['db']['callSession']['id']['find']>>;
type TaskRow = NonNullable<ReturnType<Ctx['db']['supportTask']['id']['find']>>;

const AGENT_NAME = 'HoldLess Agent';
const HEARTBEAT_STALE_MICROS = 15_000_000n;
const UNCLAIMED_TIMEOUT_MICROS = 20_000_000n;

function micros(ts: Timestamp): bigint {
  return ts.microsSinceUnixEpoch;
}

function requireOrchestrator(ctx: Ctx) {
  const row = ctx.db.orchestrator.id.find(0);
  if (!row || !row.identity.isEqual(ctx.sender)) throw new SenderError('Only the call orchestrator may do this');
  return row;
}

function requireCall(ctx: Ctx, callId: bigint): CallRow {
  const call = ctx.db.callSession.id.find(callId);
  if (!call) throw new SenderError(`Call ${callId} not found`);
  return call;
}

function addEvent(
  ctx: Ctx,
  callId: bigint,
  type: string,
  actor: string,
  title: string,
  description = '',
  metadata = '',
  dedupeKey = '',
) {
  if (dedupeKey) {
    for (const existing of ctx.db.callEvent.dedupeKey.filter(dedupeKey)) {
      if (existing.callId === callId) return false;
    }
  }
  ctx.db.callEvent.insert({
    id: 0n,
    callId,
    timestamp: ctx.timestamp,
    type,
    actor,
    title,
    description,
    metadata,
    dedupeKey,
  });
  return true;
}

function setAgent(ctx: Ctx, callId: bigint, status: string, currentTask: string) {
  const row = { callId, agentName: AGENT_NAME, status, currentTask, updatedAt: ctx.timestamp };
  if (ctx.db.agentStatus.callId.find(callId)) ctx.db.agentStatus.callId.update(row);
  else ctx.db.agentStatus.insert(row);
}

/** Single choke point for every status change: enforces the state machine and stamps milestones. */
function transition(ctx: Ctx, call: CallRow, to: CallStatus, patch: Partial<CallRow> = {}): CallRow {
  const from = call.status as CallStatus;
  if (!canTransition(from, to)) throw new SenderError(`Illegal transition ${from} -> ${to}`);
  const next: CallRow = { ...call, ...patch, status: to, updatedAt: ctx.timestamp };
  if (to === 'ON_HOLD' && !call.holdStartedAt) next.holdStartedAt = ctx.timestamp;
  if (to === 'HUMAN_DETECTED' && !call.humanDetectedAt) next.humanDetectedAt = ctx.timestamp;
  if (to === 'USER_CONNECTED' && !call.connectedAt) next.connectedAt = ctx.timestamp;
  if (isTerminal(to) && !call.endedAt) next.endedAt = ctx.timestamp;
  return ctx.db.callSession.id.update(next);
}

function cleanPhone(raw: string, field: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (!/^\+?\d{7,15}$/.test(digits)) throw new SenderError(`${field} must be a valid phone number`);
  return digits.startsWith('+') ? digits : digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function requireText(value: string, field: string, max = 500): string {
  const v = value.trim();
  if (!v) throw new SenderError(`${field} is required`);
  if (v.length > max) throw new SenderError(`${field} is too long`);
  return v;
}

export const init = spacetimedb.init((ctx) => {
  ctx.db.watchdogTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(5_000_000n) });
});

// ---------------------------------------------------------------------------
// Client-facing reducers
// ---------------------------------------------------------------------------

export const requestCall = spacetimedb.reducer(
  {
    companyName: t.string(),
    phoneNumber: t.string(),
    userGoal: t.string(),
    userPhoneNumber: t.string(),
    userContext: t.string(),
    source: t.string(),
    demo: t.bool(),
  },
  (ctx, args) => {
    const companyName = requireText(args.companyName, 'Company', 80);
    const userGoal = requireText(args.userGoal, 'Goal', 300);
    const call = ctx.db.callSession.insert({
      id: 0n,
      userId: ctx.sender.toHexString(),
      companyName,
      phoneNumber: cleanPhone(args.phoneNumber, 'Support number'),
      userGoal,
      userPhoneNumber: cleanPhone(args.userPhoneNumber, 'Your phone number'),
      status: 'REQUESTED',
      currentMenuContext: '',
      lastActionSummary: 'Waiting for the call agent to pick this up',
      humanConfidence: 0,
      errorMessage: '',
      mode: '',
      source: args.source || 'web',
      demo: args.demo,
      cancelRequested: false,
      supportCallSid: '',
      userCallSid: '',
      startedAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      holdStartedAt: undefined,
      humanDetectedAt: undefined,
      connectedAt: undefined,
      endedAt: undefined,
    });
    if (args.userContext.trim()) {
      ctx.db.userContext.insert({
        id: 0n,
        callId: call.id,
        source: 'manual',
        label: 'Details you provided',
        value: args.userContext.trim().slice(0, 1000),
      });
    }
    addEvent(ctx, call.id, 'CALL_REQUESTED', 'USER', `Asked for a human at ${companyName}`, userGoal);
    setAgent(ctx, call.id, 'IDLE', 'Queued for the call agent');
  },
);

export const cancelCall = spacetimedb.reducer({ callId: t.u64() }, (ctx, { callId }) => {
  const call = requireCall(ctx, callId);
  if (isTerminal(call.status as CallStatus)) return;
  if (call.status === 'REQUESTED') {
    transition(ctx, call, 'FAILED', { errorMessage: 'Cancelled before dialing' });
    addEvent(ctx, callId, 'CALL_FAILED', 'USER', 'Cancelled', 'You cancelled the call.');
    setAgent(ctx, callId, 'DONE', 'Cancelled');
    return;
  }
  ctx.db.callSession.id.update({ ...call, cancelRequested: true, updatedAt: ctx.timestamp });
  addEvent(ctx, callId, 'INFO', 'USER', 'Cancellation requested', '', '', `cancel-${callId}`);
});

// ---------------------------------------------------------------------------
// Orchestrator reducers
// ---------------------------------------------------------------------------

export const registerOrchestrator = spacetimedb.reducer(
  {
    mode: t.string(),
    demoMode: t.bool(),
    reasoning: t.string(),
    voice: t.string(),
    demoSupportNumber: t.string(),
    demoUserNumber: t.string(),
    version: t.string(),
  },
  (ctx, args) => {
    const existing = ctx.db.orchestrator.id.find(0);
    const stale = existing && micros(ctx.timestamp) - micros(existing.lastHeartbeat) > HEARTBEAT_STALE_MICROS;
    if (existing && !existing.identity.isEqual(ctx.sender) && !stale) {
      throw new SenderError('Another orchestrator is already online');
    }
    const row = { id: 0, identity: ctx.sender, ...args, lastHeartbeat: ctx.timestamp };
    if (existing) ctx.db.orchestrator.id.update(row);
    else ctx.db.orchestrator.insert(row);
  },
);

export const heartbeat = spacetimedb.reducer((ctx) => {
  const row = requireOrchestrator(ctx);
  ctx.db.orchestrator.id.update({ ...row, lastHeartbeat: ctx.timestamp });
});

export const claimCall = spacetimedb.reducer({ callId: t.u64(), mode: t.string() }, (ctx, { callId, mode }) => {
  requireOrchestrator(ctx);
  const call = requireCall(ctx, callId);
  if (call.status !== 'REQUESTED') throw new SenderError(`Call ${callId} already claimed`);
  transition(ctx, call, 'PREPARING', { mode, lastActionSummary: 'Preparing to dial' });
  setAgent(ctx, callId, 'THINKING', 'Preparing the call');
});

export const updateCallStatus = spacetimedb.reducer(
  { callId: t.u64(), status: t.string(), menuContext: t.option(t.string()), summary: t.option(t.string()) },
  (ctx, { callId, status, menuContext, summary }) => {
    requireOrchestrator(ctx);
    if (!isCallStatus(status)) throw new SenderError(`Unknown status ${status}`);
    const call = requireCall(ctx, callId);
    const patch: Partial<CallRow> = {};
    if (menuContext !== undefined) patch.currentMenuContext = menuContext;
    if (summary !== undefined) patch.lastActionSummary = summary;
    transition(ctx, call, status, patch);
  },
);

export const setCallSids = spacetimedb.reducer(
  { callId: t.u64(), supportCallSid: t.option(t.string()), userCallSid: t.option(t.string()) },
  (ctx, { callId, supportCallSid, userCallSid }) => {
    requireOrchestrator(ctx);
    const call = requireCall(ctx, callId);
    ctx.db.callSession.id.update({
      ...call,
      supportCallSid: supportCallSid ?? call.supportCallSid,
      userCallSid: userCallSid ?? call.userCallSid,
    });
  },
);

export const appendCallEvent = spacetimedb.reducer(
  {
    callId: t.u64(),
    type: t.string(),
    actor: t.string(),
    title: t.string(),
    description: t.string(),
    metadata: t.string(),
    dedupeKey: t.string(),
  },
  (ctx, a) => {
    requireOrchestrator(ctx);
    requireCall(ctx, a.callId);
    addEvent(ctx, a.callId, a.type, a.actor, a.title, a.description, a.metadata, a.dedupeKey);
  },
);

export const appendTranscript = spacetimedb.reducer(
  { callId: t.u64(), speakerType: t.string(), text: t.string(), confidence: t.f64() },
  (ctx, { callId, speakerType, text, confidence }) => {
    requireOrchestrator(ctx);
    requireCall(ctx, callId);
    if (!text.trim()) return;
    ctx.db.transcriptSegment.insert({ id: 0n, callId, speakerType, text: text.trim(), confidence, createdAt: ctx.timestamp });
  },
);

export const recordAgentAction = spacetimedb.reducer(
  {
    callId: t.u64(),
    actionType: t.string(),
    reasoningSummary: t.string(),
    actionValue: t.string(),
    confidence: t.f64(),
    status: t.string(),
  },
  (ctx, a) => {
    requireOrchestrator(ctx);
    const call = requireCall(ctx, a.callId);
    ctx.db.callAction.insert({ id: 0n, timestamp: ctx.timestamp, ...a });
    ctx.db.callSession.id.update({ ...call, lastActionSummary: a.reasoningSummary, updatedAt: ctx.timestamp });
  },
);

export const setAgentStatus = spacetimedb.reducer(
  { callId: t.u64(), status: t.string(), currentTask: t.string() },
  (ctx, { callId, status, currentTask }) => {
    requireOrchestrator(ctx);
    requireCall(ctx, callId);
    setAgent(ctx, callId, status, currentTask);
  },
);

export const updateHumanConfidence = spacetimedb.reducer(
  { callId: t.u64(), confidence: t.f64() },
  (ctx, { callId, confidence }) => {
    requireOrchestrator(ctx);
    const call = requireCall(ctx, callId);
    ctx.db.callSession.id.update({
      ...call,
      humanConfidence: Math.max(0, Math.min(1, confidence)),
      updatedAt: ctx.timestamp,
    });
  },
);

export const markHumanDetected = spacetimedb.reducer(
  { callId: t.u64(), confidence: t.f64(), evidence: t.string() },
  (ctx, { callId, confidence, evidence }) => {
    requireOrchestrator(ctx);
    const call = requireCall(ctx, callId);
    if (call.status === 'HUMAN_DETECTED') return;
    transition(ctx, call, 'HUMAN_DETECTED', {
      humanConfidence: confidence,
      lastActionSummary: 'A live representative answered',
    });
    addEvent(ctx, callId, 'HUMAN_DETECTED', 'AI', 'Representative detected', evidence, '', `human-${callId}`);
    setAgent(ctx, callId, 'HANDING_OFF', 'Representative found — calling you now');
  },
);

export const markUserConnected = spacetimedb.reducer({ callId: t.u64() }, (ctx, { callId }) => {
  requireOrchestrator(ctx);
  const call = requireCall(ctx, callId);
  if (call.status === 'USER_CONNECTED') return;
  transition(ctx, call, 'USER_CONNECTED', { lastActionSummary: 'You are talking to the representative' });
  addEvent(ctx, callId, 'USER_CONNECTED', 'USER', 'You joined the call', 'The AI has stepped away.', '', `connected-${callId}`);
  setAgent(ctx, callId, 'DONE', 'Handed off — the AI is no longer on the line');
});

export const completeCall = spacetimedb.reducer({ callId: t.u64(), summary: t.string() }, (ctx, { callId, summary }) => {
  requireOrchestrator(ctx);
  const call = requireCall(ctx, callId);
  if (isTerminal(call.status as CallStatus)) return;
  transition(ctx, call, 'COMPLETED', { lastActionSummary: summary });
  addEvent(ctx, callId, 'CALL_COMPLETED', 'SYSTEM', 'Call ended', summary, '', `completed-${callId}`);
  setAgent(ctx, callId, 'DONE', 'Call ended');
});

export const failCall = spacetimedb.reducer(
  { callId: t.u64(), errorMessage: t.string() },
  (ctx, { callId, errorMessage }) => {
    requireOrchestrator(ctx);
    const call = requireCall(ctx, callId);
    if (isTerminal(call.status as CallStatus)) return;
    transition(ctx, call, 'FAILED', { errorMessage, lastActionSummary: errorMessage });
    addEvent(ctx, callId, 'CALL_FAILED', 'SYSTEM', 'Call failed', errorMessage, '', `failed-${callId}`);
    setAgent(ctx, callId, 'ERROR', errorMessage);
  },
);

/** Fails requests nobody picked up, so the dashboard never spins forever when the orchestrator is offline. */
export const watchdog = spacetimedb.reducer({ onSchedule: watchdogTimer }, { timer: watchdogTimer.rowType }, (ctx) => {
  const orch = ctx.db.orchestrator.id.find(0);
  const now = micros(ctx.timestamp);
  const online = orch && now - micros(orch.lastHeartbeat) < HEARTBEAT_STALE_MICROS;
  if (online) return;
  for (const call of ctx.db.callSession.iter()) {
    if (call.status === 'REQUESTED' && now - micros(call.startedAt) > UNCLAIMED_TIMEOUT_MICROS) {
      transition(ctx, call, 'FAILED', { errorMessage: 'No call agent is online. Start the orchestrator and retry.' });
      addEvent(ctx, call.id, 'CALL_FAILED', 'SYSTEM', 'No call agent online', 'Start the orchestrator and retry.');
      setAgent(ctx, call.id, 'ERROR', 'No call agent online');
    }
  }
});

// ---------------------------------------------------------------------------
// Support tasks (browser agent, email): same pattern as calls — clients request,
// the orchestrator claims and drives, every step is a row the UI subscribes to.
// ---------------------------------------------------------------------------

function requireTask(ctx: Ctx, taskId: bigint): TaskRow {
  const task = ctx.db.supportTask.id.find(taskId);
  if (!task) throw new SenderError(`Task ${taskId} not found`);
  return task;
}

function requireTaskOwnerOrOrchestrator(ctx: Ctx, task: TaskRow) {
  const orch = ctx.db.orchestrator.id.find(0);
  const isOrchestrator = !!orch && orch.identity.isEqual(ctx.sender);
  if (task.userId !== ctx.sender.toHexString() && !isOrchestrator) throw new SenderError('Not your task');
}

function addTaskEvent(ctx: Ctx, taskId: bigint, kind: string, title: string, description = '') {
  ctx.db.taskEvent.insert({ id: 0n, taskId, timestamp: ctx.timestamp, kind, title, description });
}

function moveTask(ctx: Ctx, task: TaskRow, to: TaskStatus, patch: Partial<TaskRow> = {}): TaskRow {
  const from = task.status as TaskStatus;
  if (!canTaskTransition(from, to)) throw new SenderError(`Illegal task transition ${from} -> ${to}`);
  const next: TaskRow = { ...task, ...patch, status: to, updatedAt: ctx.timestamp };
  if (isTaskTerminal(to) && !task.endedAt) next.endedAt = ctx.timestamp;
  return ctx.db.supportTask.id.update(next);
}

export const requestTask = spacetimedb.reducer(
  { channel: t.string(), provider: t.string(), query: t.string(), paramsJson: t.string() },
  (ctx, { channel, provider, query, paramsJson }) => {
    if (!isTaskChannel(channel) || channel === 'phone') throw new SenderError('Use requestCall for phone tasks');
    const q = requireText(query, 'Request', 500);
    if (paramsJson.length > 4000) throw new SenderError('Task details are too long');
    try {
      JSON.parse(paramsJson || '{}');
    } catch {
      throw new SenderError('Task details must be JSON');
    }
    const task = ctx.db.supportTask.insert({
      id: 0n,
      userId: ctx.sender.toHexString(),
      channel,
      provider: requireText(provider, 'Provider', 80),
      query: q,
      paramsJson: paramsJson || '{}',
      status: 'REQUESTED',
      step: 'Queued',
      summary: 'Waiting for the agent to pick this up',
      result: '',
      errorMessage: '',
      approveRequested: false,
      cancelRequested: false,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      endedAt: undefined,
    });
    addTaskEvent(ctx, task.id, 'info', `Requested: ${provider} ${channel} task`, q);
  },
);

/** The user approves the agent's pending consequential step (e.g. "Confirm your return"). */
export const approveTask = spacetimedb.reducer({ taskId: t.u64() }, (ctx, { taskId }) => {
  const task = requireTask(ctx, taskId);
  requireTaskOwnerOrOrchestrator(ctx, task);
  if (isTaskTerminal(task.status as TaskStatus) || task.approveRequested) return;
  ctx.db.supportTask.id.update({ ...task, approveRequested: true, updatedAt: ctx.timestamp });
  addTaskEvent(ctx, taskId, 'action', 'You approved the final step');
});

export const cancelTask = spacetimedb.reducer({ taskId: t.u64() }, (ctx, { taskId }) => {
  const task = requireTask(ctx, taskId);
  requireTaskOwnerOrOrchestrator(ctx, task);
  if (isTaskTerminal(task.status as TaskStatus)) return;
  if (task.status === 'REQUESTED') {
    moveTask(ctx, task, 'CANCELLED', { summary: 'Cancelled before starting' });
  } else {
    ctx.db.supportTask.id.update({ ...task, cancelRequested: true, updatedAt: ctx.timestamp });
  }
  addTaskEvent(ctx, taskId, 'info', 'Cancellation requested');
});

export const claimTask = spacetimedb.reducer({ taskId: t.u64() }, (ctx, { taskId }) => {
  requireOrchestrator(ctx);
  const task = requireTask(ctx, taskId);
  if (task.status !== 'REQUESTED') throw new SenderError(`Task ${taskId} already claimed`);
  moveTask(ctx, task, 'RUNNING', { step: 'Starting', summary: 'Agent started' });
});

export const updateTask = spacetimedb.reducer(
  { taskId: t.u64(), status: t.string(), step: t.string(), summary: t.string() },
  (ctx, { taskId, status, step, summary }) => {
    requireOrchestrator(ctx);
    if (!isTaskStatus(status)) throw new SenderError(`Unknown task status ${status}`);
    const task = requireTask(ctx, taskId);
    // Leaving WAITING_FOR_USER consumes a pending approval.
    const approveRequested = status === 'WAITING_FOR_USER' ? task.approveRequested : false;
    moveTask(ctx, task, status, { step: step.slice(0, 120), summary: summary.slice(0, 300), approveRequested });
  },
);

export const appendTaskEvent = spacetimedb.reducer(
  { taskId: t.u64(), kind: t.string(), title: t.string(), description: t.string() },
  (ctx, { taskId, kind, title, description }) => {
    requireOrchestrator(ctx);
    requireTask(ctx, taskId);
    addTaskEvent(ctx, taskId, kind, title.slice(0, 200), description.slice(0, 1000));
  },
);

export const completeTask = spacetimedb.reducer(
  { taskId: t.u64(), summary: t.string(), result: t.string() },
  (ctx, { taskId, summary, result }) => {
    requireOrchestrator(ctx);
    const task = requireTask(ctx, taskId);
    if (isTaskTerminal(task.status as TaskStatus)) return;
    moveTask(ctx, task, 'COMPLETED', { step: 'Done', summary, result: result.slice(0, 1000), approveRequested: false });
    addTaskEvent(ctx, taskId, 'success', summary, result);
  },
);

export const failTask = spacetimedb.reducer(
  { taskId: t.u64(), errorMessage: t.string(), cancelled: t.bool() },
  (ctx, { taskId, errorMessage, cancelled }) => {
    requireOrchestrator(ctx);
    const task = requireTask(ctx, taskId);
    if (isTaskTerminal(task.status as TaskStatus)) return;
    moveTask(ctx, task, cancelled ? 'CANCELLED' : 'FAILED', { step: cancelled ? 'Cancelled' : 'Failed', summary: errorMessage, errorMessage });
    addTaskEvent(ctx, taskId, cancelled ? 'info' : 'error', cancelled ? 'Cancelled' : 'Task failed', errorMessage);
  },
);
