import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { attempts, paymentIntents } from '@twokey-arc/db';
import {
  cancelPayment,
  decideApproval,
  driftDemo,
  expireApprovals,
  getApproval,
  getPayment,
  listAudit,
  requestPayment,
  TwokeyError,
  verifyAudit,
} from '../src';
import { ATTACKER, BRIGHTLINE, createHarness, ORG, type Harness } from './harness';

let h: Harness;
let n = 0;
const key = () => `invoice-${++n}-${Date.now()}`;

beforeEach(async () => {
  await h?.close();
  h = await createHarness();
});
afterAll(async () => h?.close());

const pay = (body: unknown, idem = key()) => requestPayment(h.deps, { agentId: 'ap-agent', idempotencyKey: idem, body });
const approve = (approvalId: string, seal?: string) => decideApproval(h.deps, { approvalId, decision: 'approve', ...(seal ? { seal } : {}), by: 'Prabal', via: 'dashboard' });
const sealOfApproval = async (id: string) => (await getApproval(h.db, ORG, id))!.approval.seal;
const verbs = async () => (await listAudit(h.db, ORG)).map((e) => e.verb);
const rejectsWith = async (p: Promise<unknown>, code: string, status = 409) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(TwokeyError);
  expect((err as TwokeyError).code).toBe(code);
  expect((err as TwokeyError).status).toBe(status);
};

describe('inside the mandate', () => {
  it('runs on its own, reaches PAID with a tx hash, and the audit chain verifies', async () => {
    const { response } = await pay({ payee: { payeeId: 'pay_oceanic' }, amount: '25.00', memo: 'INV-88213' });
    expect(response).toMatchObject({ outcome: 'executed', lane: 'INSIDE_MANDATE', ruleId: 'R-WM-PAY', status: 'QUEUED' });
    await h.drain();
    const paid = await getPayment(h.db, h.deps.cfg, response.paymentId);
    expect(paid?.status).toBe('PAID');
    expect(paid?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(paid?.explorerUrl).toBe(`https://explorer.testnet.arc.io/tx/${paid?.txHash}`);
    expect(h.circle.transfersFor(response.paymentId)).toHaveLength(1);
    const v = await verbs();
    for (const verb of ['payment.requested', 'policy.classified', 'attempt.created', 'circle.transaction_created', 'payment.completed']) {
      expect(v).toContain(verb);
    }
    const completed = (await listAudit(h.db, ORG)).find((e) => e.verb === 'payment.completed')!;
    expect(completed.data).toMatchObject({ circle_transaction_id: expect.any(String), tx_hash: paid?.txHash, fee: '0.010000' });
    expect(await verifyAudit(h.db, ORG)).toMatchObject({ ok: true });
  });

  it('writes the attempt row before Circle is called (write-ahead)', async () => {
    const seen: number[] = [];
    h.circle.onCreate = async (idempotencyKey) => {
      const rows = await h.db.select().from(attempts).where(eq(attempts.circleIdempotencyKey, idempotencyKey));
      seen.push(rows.length);
    };
    await pay({ payee: { payeeId: 'pay_oceanic' }, amount: '1.00' });
    await h.drain();
    expect(seen).toEqual([1]);
  });
});

describe('outside the mandate: the second key', () => {
  it('makes no Circle call until a valid approval exists, then pays once', async () => {
    const { response } = await pay({ payee: { address: BRIGHTLINE, name: 'Brightline Media' }, amount: '75.00', memo: 'BM-7' });
    expect(response).toMatchObject({ outcome: 'pending_approval', ruleId: 'R-EX-PAY', status: 'AWAITING_APPROVAL' });
    expect(response.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual(['payee_known', 'per_tx_limit']);
    await h.drain();
    expect(h.circle.calls.createTransfer).toBe(0);

    const approvalId = response.approval!.id;
    await rejectsWith(approve(approvalId, `sha256:${'0'.repeat(64)}`), 'seal_mismatch');
    expect(h.circle.calls.createTransfer).toBe(0);

    await approve(approvalId, await sealOfApproval(approvalId));
    await h.drain();
    expect((await getPayment(h.db, h.deps.cfg, response.paymentId))?.status).toBe('PAID');
    expect(h.circle.calls.createTransfer).toBe(1);
    expect(await verbs()).toEqual(expect.arrayContaining(['approval.requested', 'approval.seal_mismatch', 'approval.approved', 'approval.consumed']));
  });

  it('a seal from another approval is stale and refused', async () => {
    const a = await pay({ payee: { address: BRIGHTLINE }, amount: '75.00' });
    const b = await pay({ payee: { payeeId: 'pay_harbor' }, amount: '60.00' });
    await rejectsWith(approve(a.response.approval!.id, await sealOfApproval(b.response.approval!.id)), 'seal_mismatch');
  });

  it('drift after approval voids it at execute time; nothing is sent', async () => {
    const { response } = await pay({ payee: { payeeId: 'pay_harbor' }, amount: '60.00', memo: 'HC-2210' });
    const approvalId = response.approval!.id;
    await approve(approvalId, await sealOfApproval(approvalId));
    expect(await driftDemo(h.deps, response.paymentId)).toEqual({ from: '60.000000', to: '60.500000' });
    await h.drain();
    const after = await getApproval(h.db, ORG, approvalId);
    expect(after?.approval).toMatchObject({ status: 'VOIDED', voidReason: 'terms_changed', voidDetail: { amount_from: '60.000000', amount_to: '60.500000' } });
    expect(after?.intent.status).toBe('VOIDED');
    expect(h.circle.calls.createTransfer).toBe(0);
  });

  it('drift while pending voids at decision time with 409 terms_changed', async () => {
    const { response } = await pay({ payee: { payeeId: 'pay_harbor' }, amount: '60.00' });
    const id = response.approval!.id;
    const shown = await sealOfApproval(id);
    await driftDemo(h.deps, response.paymentId, '0.01');
    await rejectsWith(approve(id, shown), 'terms_changed');
    expect((await getApproval(h.db, ORG, id))?.approval.status).toBe('VOIDED');
  });

  it('an expired approval cannot be approved, and the expiry job closes it', async () => {
    const a = await pay({ payee: { address: BRIGHTLINE }, amount: '75.00' });
    const b = await pay({ payee: { address: BRIGHTLINE }, amount: '76.00' });
    h.clock.advance(16 * 60_000);
    await rejectsWith(approve(a.response.approval!.id, await sealOfApproval(a.response.approval!.id)), 'expired');
    expect(await expireApprovals(h.deps)).toBe(1);
    expect((await getPayment(h.db, h.deps.cfg, b.response.paymentId))?.status).toBe('EXPIRED');
    expect(h.circle.calls.createTransfer).toBe(0);
  });

  it('reject needs a reason', async () => {
    const { response } = await pay({ payee: { address: BRIGHTLINE }, amount: '75.00' });
    const id = response.approval!.id;
    await rejectsWith(decideApproval(h.deps, { approvalId: id, decision: 'reject', by: 'Prabal', via: 'dashboard' }), 'reason_required', 400);
    await decideApproval(h.deps, { approvalId: id, decision: 'reject', reason: 'not our vendor', by: 'Prabal', via: 'dashboard' });
    expect((await getPayment(h.db, h.deps.cfg, response.paymentId))?.status).toBe('REJECTED');
    await rejectsWith(approve(id, await sealOfApproval(id)), 'not_pending');
  });

  it('a Telegram decision carries only the seal prefix, checked against the stored seal', async () => {
    const { response } = await pay({ payee: { address: BRIGHTLINE }, amount: '75.00' });
    const id = response.approval!.id;
    const seal = await sealOfApproval(id);
    await rejectsWith(decideApproval(h.deps, { approvalId: id, decision: 'approve', sealPrefix: '000000000000', by: 'Prabal', via: 'telegram' }), 'seal_mismatch');
    await decideApproval(h.deps, { approvalId: id, decision: 'approve', sealPrefix: seal.slice(7, 19), by: 'Prabal', via: 'telegram' });
    await h.drain();
    expect((await getPayment(h.db, h.deps.cfg, response.paymentId))?.status).toBe('PAID');
  });
});

describe('breaks a rule: blocked, no Circle call', () => {
  it.each([
    ['pinned payee at a new address', { payee: { name: 'Oceanic Freight', address: ATTACKER }, amount: '40.00' }, 'INV-PAYEE-PINNED'],
    ['zero address', { payee: { address: `0x${'0'.repeat(40)}` }, amount: '1.00' }, 'INV-ADDRESS'],
    ['over hard max', { payee: { payeeId: 'pay_oceanic' }, amount: '1000.01' }, 'INV-HARD-MAX'],
    ['insufficient funds', { payee: { payeeId: 'pay_oceanic' }, amount: '199.995' }, 'INV-FUNDS'],
  ])('%s -> %s', async (_name, body, rule) => {
    const { response } = await pay(body);
    expect(response).toMatchObject({ outcome: 'blocked', lane: 'BREAKS_RULE', ruleId: rule, status: 'BLOCKED' });
    await h.drain();
    expect(h.circle.calls.createTransfer).toBe(0);
  });

  it('rejects malformed requests before classification', async () => {
    await rejectsWith(pay({ payee: {}, amount: 25 }), 'invalid_request', 400);
    await rejectsWith(requestPayment(h.deps, { agentId: 'ap-agent', idempotencyKey: 'short', body: { payee: {}, amount: '1' } }), 'idempotency_key_required', 400);
  });
});

describe('idempotency and races', () => {
  it('the same Idempotency-Key 5x in parallel gives one intent and one Circle transaction', async () => {
    const idem = key();
    const body = { payee: { payeeId: 'pay_oceanic' }, amount: '2.00', memo: 'INV-1' };
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(body, idem)));
    expect(new Set(results.map((r) => r.response.paymentId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    await h.drain();
    expect(h.circle.transfersFor(results[0]!.response.paymentId)).toHaveLength(1);
  });

  it('the same key with a different body is 409', async () => {
    const idem = key();
    await pay({ payee: { payeeId: 'pay_oceanic' }, amount: '2.00' }, idem);
    await rejectsWith(pay({ payee: { payeeId: 'pay_oceanic' }, amount: '2.01' }, idem), 'idempotency_key_reused');
  });

  it('the daily cap holds under 10 concurrent auto requests', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => pay({ payee: { payeeId: 'pay_oceanic' }, amount: '40.00' })));
    const auto = results.filter((r) => r.response.outcome === 'executed');
    expect(auto.length).toBeLessThanOrEqual(3);
    await h.drain();
    const paidWithoutApproval = await h.db.execute<{ total: string }>(
      sql`select coalesce(sum(amount),0)::text as total from payment_intents where status = 'PAID' and approved = false`,
    );
    expect(Number(paidWithoutApproval.rows[0]!.total)).toBeLessThanOrEqual(150);
    expect(h.circle.txs.size).toBeLessThanOrEqual(3);
  });

  it('a lane that rose before execution turns into an approval instead of a transfer', async () => {
    const { response } = await pay({ payee: { payeeId: 'pay_oceanic' }, amount: '40.00' });
    expect(response.outcome).toBe('executed');
    // Spend the request didn't see (third classification must catch it): 120 auto-paid today.
    const other = await pay({ payee: { payeeId: 'pay_harbor' }, amount: '40.00' });
    await h.db
      .update(paymentIntents)
      .set({ status: 'PAID', amount: '120.000000' })
      .where(eq(paymentIntents.id, other.response.paymentId));
    h.jobs.queue = h.jobs.queue.filter((j) => j.data.intentId !== other.response.paymentId);
    await h.drain();
    const after = await getPayment(h.db, h.deps.cfg, response.paymentId);
    expect(after).toMatchObject({ status: 'AWAITING_APPROVAL', lane: 'ADDS_RISK', ruleId: 'R-EX-PAY' });
    expect(after?.approval?.status).toBe('PENDING');
    expect(h.circle.calls.createTransfer).toBe(0);
  });
});

describe('cancel lowers risk', () => {
  it('cancels a payment waiting for approval and voids the approval', async () => {
    const { response } = await pay({ payee: { address: BRIGHTLINE }, amount: '75.00' });
    const p = await cancelPayment(h.deps, { intentId: response.paymentId, actor: { type: 'agent', id: 'ap-agent' }, agentId: 'ap-agent' });
    expect(p?.status).toBe('CANCELLED');
    expect((await getApproval(h.db, ORG, response.approval!.id))?.approval).toMatchObject({ status: 'VOIDED', voidReason: 'cancelled' });
  });

  it('cannot cancel once paid', async () => {
    const { response } = await pay({ payee: { payeeId: 'pay_oceanic' }, amount: '1.00' });
    await h.drain();
    await rejectsWith(cancelPayment(h.deps, { intentId: response.paymentId, actor: { type: 'user', id: 'owner' } }), 'not_cancellable');
  });
});

describe('audit log', () => {
  it('is append-only at the database level', async () => {
    await pay({ payee: { payeeId: 'pay_oceanic' }, amount: '1.00' });
    const cause = (p: Promise<unknown>) => p.then(() => '', (e: Error & { cause?: Error }) => e.cause?.message ?? e.message);
    expect(await cause(h.db.execute(sql`update audit_log set verb = 'x' where seq = 1`))).toMatch(/append-only/);
    expect(await cause(h.db.execute(sql`delete from audit_log where seq = 1`))).toMatch(/append-only/);
  });

  it('keeps one chain per org: two orgs in one database each start at seq 1', async () => {
    const { appendAudit } = await import('../src');
    const now = h.clock.now();
    await h.db.transaction((tx) =>
      appendAudit(tx, 'org_other', { at: now, actorType: 'system', actorId: 't', verb: 'x.one', subjectType: 's', subjectId: '1', data: {} }),
    );
    await pay({ payee: { payeeId: 'pay_oceanic' }, amount: '1.00' });
    expect((await listAudit(h.db, 'org_other'))[0]?.seq).toBe(1);
    expect(await verifyAudit(h.db, 'org_other')).toMatchObject({ ok: true, length: 1 });
    expect(await verifyAudit(h.db, ORG)).toMatchObject({ ok: true });
  });

  it('reports the first broken row when one is edited (scratch copy, trigger disabled)', async () => {
    await pay({ payee: { payeeId: 'pay_oceanic' }, amount: '1.00' });
    await h.drain();
    expect(await verifyAudit(h.db, ORG)).toMatchObject({ ok: true });
    await h.db.execute(sql`alter table audit_log disable trigger audit_log_no_update_delete`);
    await h.db.execute(sql`update audit_log set data = jsonb_set(data, '{amount}', '"999.000000"') where verb = 'payment.requested'`);
    const v = await verifyAudit(h.db, ORG);
    expect(v).toMatchObject({ ok: false, firstBrokenSeq: 2 });
  });
});
