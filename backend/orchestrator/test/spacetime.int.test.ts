import { describe, expect, it } from 'vitest';
import { DbConnection, type CallSession } from '@holdless/db';

const HOST = process.env.SPACETIMEDB_HOST ?? 'ws://127.0.0.1:3000';
const MODULE = process.env.SPACETIMEDB_MODULE ?? 'holdless';
const reachable = await fetch(HOST.replace(/^ws/, 'http') + '/v1/ping').then((r) => r.ok, () => false);

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(MODULE)
      .onConnect((conn) =>
        conn.subscriptionBuilder().onApplied(() => resolve(conn)).onError(() => reject(new Error('subscribe failed'))).subscribe('SELECT * FROM call_session'),
      )
      .onConnectError((_c, e) => reject(e))
      .build();
  });
}

const until = async (pred: () => boolean, ms = 5000) => {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe.skipIf(!reachable)('SpacetimeDB module reducers (live local server)', () => {
  it('validates requests, blocks non-orchestrators, and cancels', async () => {
    const conn = await connect();
    const me = conn.identity!.toHexString();

    await expect(
      conn.reducers.requestCall({ companyName: '', phoneNumber: '+17345550142', userGoal: 'x', userPhoneNumber: '+15555550100', userContext: '', source: 'test', demo: false }),
    ).rejects.toThrow(/Company is required/);
    await expect(
      conn.reducers.requestCall({ companyName: 'Acme', phoneNumber: 'abc', userGoal: 'x', userPhoneNumber: '+15555550100', userContext: '', source: 'test', demo: false }),
    ).rejects.toThrow(/valid phone/);

    const tag = `Acme Test ${Date.now()}`;
    await conn.reducers.requestCall({ companyName: tag, phoneNumber: '734 555 0142', userGoal: 'Talk to someone about a refund', userPhoneNumber: '5555550100', userContext: '', source: 'test', demo: false });
    let call: CallSession | undefined;
    await until(() => !!(call = [...conn.db.callSession.iter()].find((c) => c.companyName === tag)));
    expect(call!.userId).toBe(me);
    expect(call!.phoneNumber).toBe('+17345550142');

    // Only the registered orchestrator may drive the state machine.
    await expect(conn.reducers.updateCallStatus({ callId: call!.id, status: 'USER_CONNECTED', menuContext: undefined, summary: undefined })).rejects.toThrow(/orchestrator/);
    await expect(conn.reducers.markHumanDetected({ callId: call!.id, confidence: 1, evidence: 'x' })).rejects.toThrow(/orchestrator/);

    await conn.reducers.cancelCall({ callId: call!.id });
    await until(() => {
      const c = conn.db.callSession.id.find(call!.id)!;
      return c.status === 'FAILED' || c.cancelRequested || c.status === 'COMPLETED';
    });
    conn.disconnect();
  });
});

describe.skipIf(!reachable)('support task reducers (live local server)', () => {
  it('validates requests, keeps tasks owner-only and orchestrator-driven', async () => {
    const owner = await connect();
    const stranger = await connect();
    await owner.subscriptionBuilder().subscribe('SELECT * FROM support_task');

    await expect(owner.reducers.requestTask({ channel: 'phone', provider: 'Amazon', query: 'x', paramsJson: '{}' })).rejects.toThrow(/requestCall/);
    await expect(owner.reducers.requestTask({ channel: 'browser', provider: 'Amazon', query: 'x', paramsJson: 'not json' })).rejects.toThrow(/JSON/);
    await expect(owner.reducers.requestTask({ channel: 'browser', provider: 'Amazon', query: '  ', paramsJson: '{}' })).rejects.toThrow(/required/);

    const tag = `Return test item ${Date.now()}`;
    await owner.reducers.requestTask({ channel: 'browser', provider: 'Test Store', query: tag, paramsJson: JSON.stringify({ item: tag, reason: 'test' }) });
    let task: { id: bigint; status: string; approveRequested: boolean; cancelRequested: boolean } | undefined;
    await until(() => !!(task = [...owner.db.supportTask.iter()].find((t) => t.query === tag)));

    // Only the orchestrator may move a task forward; only the owner may approve/cancel it.
    await expect(owner.reducers.claimTask({ taskId: task!.id })).rejects.toThrow(/orchestrator/);
    await expect(owner.reducers.completeTask({ taskId: task!.id, summary: 'x', result: 'x' })).rejects.toThrow(/orchestrator/);
    await expect(stranger.reducers.approveTask({ taskId: task!.id })).rejects.toThrow(/Not your task/);
    await expect(stranger.reducers.cancelTask({ taskId: task!.id })).rejects.toThrow(/Not your task/);

    await owner.reducers.cancelTask({ taskId: task!.id });
    await until(() => {
      const t = owner.db.supportTask.id.find(task!.id)!;
      return t.status === 'CANCELLED' || t.status === 'FAILED' || t.cancelRequested;
    });
    owner.disconnect();
    stranger.disconnect();
  });
});
