import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { attempts } from '@twokey-arc/db';
import { getPayment, listAudit, pollAttempt, prepareExecution, reconcileAttempt, requestPayment, sweep, verifyAudit } from '../src';
import { createHarness, ORG, type Harness } from './harness';

let h: Harness;
let n = 0;

beforeEach(async () => {
  await h?.close();
  h = await createHarness();
});
afterAll(async () => h?.close());

const pay = (amount = '0.10') =>
  requestPayment(h.deps, { agentId: 'ap-agent', idempotencyKey: `chaos-${++n}-${Date.now()}`, body: { payee: { payeeId: 'pay_oceanic' }, amount } });
const status = async (id: string) => (await getPayment(h.db, h.deps.cfg, id))?.status;
const attemptOf = async (intentId: string) => (await h.db.select().from(attempts).where(eq(attempts.intentId, intentId)))[0]!;

describe('ambiguous results never mint a new idempotency key', () => {
  it('timeout after Circle created the transfer: reconcile finds it by refId, one transaction', async () => {
    h.circle.mode = 'timeout_after_create';
    const { response } = await pay();
    await h.drain({ skip: ['attempt.reconcile'] });
    expect(await status(response.paymentId)).toBe('UNCONFIRMED');
    h.circle.mode = 'ok';
    const att = await attemptOf(response.paymentId);
    expect(await reconcileAttempt(h.deps, att.id)).toBe('found');
    await h.drain();
    expect(await status(response.paymentId)).toBe('PAID');
    expect(h.circle.transfersFor(response.paymentId)).toHaveLength(1);
    expect(h.circle.calls.createTransfer).toBe(1);
  });

  it('timeout before Circle saw it: after the window, resubmits with the SAME key, one transaction', async () => {
    h.circle.mode = 'timeout_before_create';
    const { response } = await pay();
    await h.drain({ skip: ['attempt.reconcile'] });
    const att = await attemptOf(response.paymentId);
    expect(await reconcileAttempt(h.deps, att.id)).toBe('waiting');
    h.circle.mode = 'ok';
    h.clock.advance(121_000);
    expect(await reconcileAttempt(h.deps, att.id)).toBe('resubmitted');
    await h.drain();
    expect(await status(response.paymentId)).toBe('PAID');
    const tx = h.circle.transfersFor(response.paymentId);
    expect(tx).toHaveLength(1);
    expect(tx[0]!.idempotencyKey).toBe(att.circleIdempotencyKey);
  });

  it('gives up to a person after maxTries resubmits', async () => {
    h.circle.mode = 'timeout_before_create';
    const { response } = await pay();
    await h.drain({ skip: ['attempt.reconcile'] });
    const att = await attemptOf(response.paymentId);
    h.clock.advance(121_000);
    for (let i = 0; i < 3; i++) await reconcileAttempt(h.deps, att.id);
    expect(await reconcileAttempt(h.deps, att.id)).toBe('needs_human');
    expect(await status(response.paymentId)).toBe('NEEDS_HUMAN');
    expect(h.circle.txs.size).toBe(0);
  });

  it('crash after the attempt commit, before the Circle call: the sweeper recovers with the same key', async () => {
    const { response } = await pay();
    h.jobs.queue = [];
    const prepared = await prepareExecution(h.deps, response.paymentId);
    expect(prepared.kind).toBe('submit');
    expect(h.circle.calls.createTransfer).toBe(0);
    expect((await attemptOf(response.paymentId)).state).toBe('PENDING_SUBMIT');

    h.clock.advance(16_000);
    expect(await sweep(h.deps)).toMatchObject({ unconfirmed: 1 });
    h.clock.advance(121_000);
    await h.drain();
    expect(await status(response.paymentId)).toBe('PAID');
    expect(h.circle.transfersFor(response.paymentId)).toHaveLength(1);
    expect(h.circle.transfersFor(response.paymentId)[0]!.idempotencyKey).toBe((await attemptOf(response.paymentId)).circleIdempotencyKey);
  });

  it('running execute twice for one intent sends once', async () => {
    const { response } = await pay();
    await h.drain();
    await h.jobs.send('payment.execute', { intentId: response.paymentId });
    await h.drain();
    expect(h.circle.calls.createTransfer).toBe(1);
  });
});

describe('terminal failures are never retried automatically', () => {
  it.each(['FAILED', 'DENIED'] as const)('%s -> intent FAILED, one call, audited', async (state) => {
    h.circle.finalState = state;
    const { response } = await pay();
    await h.drain();
    expect(await status(response.paymentId)).toBe('FAILED');
    expect(h.circle.calls.createTransfer).toBe(1);
    h.clock.advance(60_000);
    await sweep(h.deps);
    await h.drain();
    expect(h.circle.calls.createTransfer).toBe(1);
    const failed = (await listAudit(h.db, ORG)).find((e) => e.verb === 'payment.failed');
    expect(failed?.data).toMatchObject({ state, error: 'INSUFFICIENT_NATIVE_TOKEN' });
  });

  it('a 4xx at submit fails the payment without a retry', async () => {
    h.circle.mode = 'reject';
    const { response } = await pay();
    await h.drain();
    expect(await status(response.paymentId)).toBe('FAILED');
    expect(h.circle.calls.createTransfer).toBe(1);
  });

  it('poll of an unknown or finished attempt does nothing', async () => {
    const { response } = await pay();
    await h.drain();
    expect(await pollAttempt(h.deps, (await attemptOf(response.paymentId)).id)).toBeNull();
    expect(await pollAttempt(h.deps, 'att_missing')).toBeNull();
    expect(await verifyAudit(h.db, ORG)).toMatchObject({ ok: true });
  });
});
