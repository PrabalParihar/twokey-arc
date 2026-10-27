import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import { approvals, attempts, balanceSnapshots, paymentIntents, type Tx } from '@twokey-arc/db';
import { classify } from '@twokey-arc/policy';
import { compareUsdc, toUsdc6 } from '@twokey-arc/money';
import { sealTerms, type BoundTerms } from '@twokey-arc/seal';
import { explorerTxUrl, newId, nowOf, type CoreDeps } from './base';
import { appendAudit } from './audit';
import { getActiveMandate } from './mandate';
import { autoSpentToday, lockOrg, setIntentStatus } from './state';
import { actionFromIntent, driftDetail, openApproval, termsFromIntent, voidApproval, type IntentRow } from './approvals';

/** What Twokey needs from Circle. The executor's adapter implements it over the Circle SDK; tests use a fake. */
export interface CircleTx {
  id: string;
  state: string;
  txHash?: string;
  /** Network fee in USDC, already converted to the 6-dp view. */
  feeUsdc?: string;
  errorReason?: string;
  refId?: string;
  amounts?: string[];
  destinationAddress?: string;
}

export interface CirclePort {
  getUsdcBalance(walletId: string): Promise<string>;
  estimateTransferFee(i: { walletId: string; destinationAddress: string; amount: string }): Promise<string | null>;
  createTransfer(i: {
    walletId: string;
    tokenAddress: string;
    destinationAddress: string;
    amount: string;
    idempotencyKey: string;
    refId: string;
  }): Promise<{ id: string; state: string }>;
  getTransaction(id: string): Promise<CircleTx>;
  listTransactions(i: { walletId: string; destinationAddress: string; from: Date; amount?: string }): Promise<CircleTx[]>;
}

/** `rejected`: Circle refused the request (4xx); safe to fail. `ambiguous`: it may or may not exist. */
export class CircleCallError extends Error {
  constructor(
    readonly kind: 'ambiguous' | 'rejected',
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CircleCallError';
  }
}

export interface ExecutorDeps extends CoreDeps {
  circle: CirclePort;
  reconcile?: { resubmitAfterMs: number; maxTries: number; retryDelaySeconds: number };
}

const TERMINAL = ['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED'];
const FAILED_STATES = ['FAILED', 'DENIED', 'CANCELLED'];
const DEFAULT_RECONCILE = { resubmitAfterMs: 120_000, maxTries: 3, retryDelaySeconds: 20 };

export type ExecuteResult =
  | { kind: 'noop'; reason: string }
  | { kind: 'blocked'; rule: string }
  | { kind: 'needs_approval'; approvalId: string }
  | { kind: 'voided'; reason: string }
  | { kind: 'submitted'; attemptId: string; circleTransactionId: string }
  | { kind: 'unconfirmed'; attemptId: string }
  | { kind: 'failed'; attemptId: string; code: string };

export type Prepared =
  | { kind: 'done'; result: ExecuteResult; notify?: string }
  | { kind: 'submit'; attemptId: string; idempotencyKey: string; intent: IntentRow; walletId: string };

/**
 * payment.execute. One transaction under the org lock: fresh balance and today's spend, third
 * classification, seal re-verification for approved payments, attempt row written ahead. Only after
 * that commits does Circle get called, with the attempt's idempotency key.
 */
export async function executePayment(deps: ExecutorDeps, intentId: string): Promise<ExecuteResult> {
  const prepared = await prepareExecution(deps, intentId);
  if (prepared.kind === 'done') {
    if (prepared.notify) await deps.jobs.send('approval.notify', { approvalId: prepared.notify });
    return prepared.result;
  }
  return submitAttempt(deps, prepared.attemptId);
}

/** The write-ahead half of payment.execute. Exported so tests can stop here, as a crash would. */
export async function prepareExecution(deps: ExecutorDeps, intentId: string): Promise<Prepared> {
  const { db, cfg, circle } = deps;
  const now = nowOf(deps);

  return db.transaction(async (tx): Promise<Prepared> => {
    await lockOrg(tx, cfg.orgId);
    const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).for('update');
    if (!intent || intent.status !== 'QUEUED') return { kind: 'done', result: { kind: 'noop', reason: `status ${intent?.status ?? 'missing'}` } };
    const [live] = await tx
      .select({ id: attempts.id })
      .from(attempts)
      .where(and(eq(attempts.intentId, intentId), notInArray(attempts.state, FAILED_STATES)));
    const mandate = await getActiveMandate(tx, cfg.orgId);
    if (!mandate || !intent.destinationAddress) {
      await setIntentStatus(tx, intent.id, 'QUEUED', 'BLOCKED', { lane: 'BREAKS_RULE', ruleId: 'INV-NO-MANDATE', outcome: 'blocked' }, now);
      await audit(tx, deps, now, 'policy.blocked_at_execute', intent.id, { rule: 'INV-NO-MANDATE' });
      return { kind: 'done', result: { kind: 'blocked', rule: 'INV-NO-MANDATE' } };
    }

    const walletId = mandate.source_wallet.circle_wallet_id;
    const balance = await circle.getUsdcBalance(walletId);
    const fee = (await circle.estimateTransferFee({ walletId, destinationAddress: intent.destinationAddress, amount: toUsdc6(intent.amount) }).catch(() => null)) ?? cfg.defaultFeeEstimateUsdc;
    await tx.insert(balanceSnapshots).values({ id: newId('bal'), orgId: cfg.orgId, walletId, usdcAmount: balance, feeEstimate: fee, takenAt: now, source: 'poll' });
    const state = {
      balanceUsdc: balance,
      feeEstimateUsdc: fee,
      autoSpentTodayUsdc: await autoSpentToday(tx, cfg.orgId, mandate.timezone, now, intent.id),
      liveAttemptForIntent: !!live,
    };
    const verdict = classify(actionFromIntent(intent), state, mandate, now);
    await audit(tx, deps, now, 'policy.classified', intent.id, {
      stage: 'execute',
      lane: verdict.lane,
      rule: verdict.ruleId,
      failed_checks: verdict.checks.filter((c) => !c.pass).map((c) => c.id),
      mandate_version: mandate.version,
      balance,
      fee,
      auto_spent_today: state.autoSpentTodayUsdc,
    });
    if (verdict.ruleId === 'INV-DUPLICATE') return { kind: 'done', result: { kind: 'noop', reason: 'live attempt exists' } };

    if (intent.approved) {
      const [a] = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.intentId, intent.id), eq(approvals.status, 'APPROVED')))
        .for('update');
      if (!a) {
        await setIntentStatus(tx, intent.id, 'QUEUED', 'VOIDED', {}, now);
        await audit(tx, deps, now, 'approval.missing', intent.id, {});
        return { kind: 'done', result: { kind: 'voided', reason: 'no approval' } };
      }
      const stored = a.boundTerms as BoundTerms;
      if (now.getTime() >= a.expiresAt.getTime()) {
        await voidApproval(tx, cfg, a, intent, 'expired', {}, now);
        return { kind: 'done', result: { kind: 'voided', reason: 'expired' } };
      }
      // Rebuild the terms from the intent as it will be sent; one changed byte voids the approval.
      const rebuilt = termsFromIntent(intent, mandate, cfg, stored);
      if (sealTerms(rebuilt) !== a.seal) {
        await voidApproval(tx, cfg, a, intent, 'terms_changed', driftDetail(stored, rebuilt), now);
        return { kind: 'done', result: { kind: 'voided', reason: 'terms_changed' } };
      }
      const reserve = verdict.checks.find((c) => c.id === 'reserve_after');
      if (verdict.lane === 'BREAKS_RULE' || (reserve && !reserve.pass)) {
        const reason = mandate.version !== stored.policy.mandate_version && verdict.lane === 'BREAKS_RULE' ? 'mandate_changed' : 'precondition_failed';
        await voidApproval(tx, cfg, a, intent, reason, { rule: verdict.lane === 'BREAKS_RULE' ? verdict.ruleId : 'reserve_after' }, now);
        return { kind: 'done', result: { kind: 'voided', reason } };
      }
      await tx.update(approvals).set({ status: 'CONSUMED', consumedAt: now }).where(eq(approvals.id, a.id));
      await appendAudit(tx, cfg.orgId, {
        at: now, actorType: 'system', actorId: 'executor', verb: 'approval.consumed', subjectType: 'approval', subjectId: a.id,
        data: { intent_id: intent.id, seal: a.seal },
      });
    } else if (verdict.lane === 'ADDS_RISK') {
      // The lane rose since the request (e.g. a concurrent payment used the daily cap): ask a person.
      await setIntentStatus(tx, intent.id, 'QUEUED', 'AWAITING_APPROVAL', { lane: verdict.lane, ruleId: verdict.ruleId, checks: verdict.checks, outcome: verdict.outcome }, now);
      const approval = await openApproval(tx, cfg, { ...intent, status: 'AWAITING_APPROVAL' }, verdict, mandate, now);
      return { kind: 'done', result: { kind: 'needs_approval', approvalId: approval.id }, notify: approval.id };
    } else if (verdict.lane === 'BREAKS_RULE') {
      await setIntentStatus(tx, intent.id, 'QUEUED', 'BLOCKED', { lane: verdict.lane, ruleId: verdict.ruleId, checks: verdict.checks, outcome: verdict.outcome }, now);
      return { kind: 'done', result: { kind: 'blocked', rule: verdict.ruleId } };
    }

    const attemptId = newId('att');
    const idempotencyKey = randomUUID();
    await tx.insert(attempts).values({ id: attemptId, orgId: cfg.orgId, intentId: intent.id, circleIdempotencyKey: idempotencyKey, state: 'PENDING_SUBMIT', createdAt: now });
    await setIntentStatus(tx, intent.id, 'QUEUED', 'SUBMITTED', {}, now);
    await audit(tx, deps, now, 'attempt.created', intent.id, { attempt_id: attemptId, idempotency_key: idempotencyKey });
    return { kind: 'submit', attemptId, idempotencyKey, intent, walletId };
  });
}

/** Calls Circle for a written-ahead attempt, always with the attempt's own idempotency key. */
export async function submitAttempt(deps: ExecutorDeps, attemptId: string): Promise<ExecuteResult> {
  const { db, cfg, circle } = deps;
  const [att] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!att) return { kind: 'noop', reason: 'attempt missing' };
  const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, att.intentId));
  const mandate = await getActiveMandate(db, cfg.orgId);
  const walletId = mandate!.source_wallet.circle_wallet_id;
  try {
    const res = await circle.createTransfer({
      walletId,
      tokenAddress: cfg.usdcAddress,
      destinationAddress: intent!.destinationAddress!,
      amount: toUsdc6(intent!.amount),
      idempotencyKey: att.circleIdempotencyKey,
      refId: intent!.id,
    });
    const now = nowOf(deps);
    await db.transaction(async (tx) => {
      await tx
        .update(attempts)
        .set({ circleTransactionId: res.id, state: res.state, submittedAt: att.submittedAt ?? now })
        .where(eq(attempts.id, attemptId));
      if (intent!.status === 'UNCONFIRMED') await setIntentStatus(tx, intent!.id, 'UNCONFIRMED', 'SUBMITTED', {}, now);
      await appendAudit(tx, cfg.orgId, {
        at: now, actorType: 'circle', actorId: 'wallets', verb: 'circle.transaction_created', subjectType: 'payment', subjectId: intent!.id,
        data: { attempt_id: attemptId, circle_transaction_id: res.id, state: res.state, idempotency_key: att.circleIdempotencyKey },
      });
    });
    await deps.jobs.send('attempt.poll', { attemptId }, { startAfterSeconds: 1 });
    return { kind: 'submitted', attemptId, circleTransactionId: res.id };
  } catch (err) {
    const now = nowOf(deps);
    const e = err instanceof CircleCallError ? err : new CircleCallError('ambiguous', 'unknown', String(err));
    if (e.kind === 'rejected') {
      await db.transaction(async (tx) => {
        await tx.update(attempts).set({ state: 'FAILED', errorCode: e.code, errorMessage: e.message }).where(eq(attempts.id, attemptId));
        await setIntentStatus(tx, intent!.id, intent!.status as 'SUBMITTED' | 'UNCONFIRMED', 'FAILED', {}, now);
        await audit(tx, deps, now, 'payment.failed', intent!.id, { attempt_id: attemptId, error_code: e.code, error_message: e.message, stage: 'submit' });
      });
      return { kind: 'failed', attemptId, code: e.code };
    }
    // Ambiguous: Circle may have the transfer. Keep the same key forever; reconcile decides.
    await db.transaction(async (tx) => {
      await tx.update(attempts).set({ state: 'UNCONFIRMED', submittedAt: att.submittedAt ?? now, errorCode: e.code, errorMessage: e.message }).where(eq(attempts.id, attemptId));
      if (intent!.status === 'SUBMITTED') await setIntentStatus(tx, intent!.id, 'SUBMITTED', 'UNCONFIRMED', {}, now);
      await audit(tx, deps, now, 'attempt.unconfirmed', intent!.id, { attempt_id: attemptId, error_code: e.code });
    });
    await deps.jobs.send('attempt.reconcile', { attemptId }, { startAfterSeconds: (deps.reconcile ?? DEFAULT_RECONCILE).retryDelaySeconds });
    return { kind: 'unconfirmed', attemptId };
  }
}

/** attempt.poll: mirrors Circle's state; COMPLETE pays the intent with its tx hash. Returns the next delay. */
export async function pollAttempt(deps: ExecutorDeps, attemptId: string): Promise<number | null> {
  const { db, cfg, circle } = deps;
  const [att] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!att?.circleTransactionId || TERMINAL.includes(att.state)) return null;
  const tx = await circle.getTransaction(att.circleTransactionId);
  const now = nowOf(deps);
  await db.transaction(async (t) => {
    const [cur] = await t.select().from(attempts).where(eq(attempts.id, attemptId)).for('update');
    if (!cur || TERMINAL.includes(cur.state)) return;
    const [intent] = await t.select().from(paymentIntents).where(eq(paymentIntents.id, cur.intentId));
    await t
      .update(attempts)
      .set({ state: tx.state, txHash: tx.txHash ?? cur.txHash, lastPolledAt: now, pollCount: cur.pollCount + 1, ...(tx.feeUsdc ? { feePaid: tx.feeUsdc } : {}) })
      .where(eq(attempts.id, attemptId));
    if (tx.state !== cur.state) {
      await appendAudit(t, cfg.orgId, {
        at: now, actorType: 'circle', actorId: 'wallets', verb: 'circle.state_changed', subjectType: 'payment', subjectId: cur.intentId,
        data: { attempt_id: attemptId, circle_transaction_id: cur.circleTransactionId, from: cur.state, to: tx.state, ...(tx.txHash ? { tx_hash: tx.txHash } : {}) },
      });
    }
    if (tx.state === 'COMPLETE') {
      await setIntentStatus(t, cur.intentId, intent!.status as 'SUBMITTED', 'PAID', {}, now);
      await appendAudit(t, cfg.orgId, {
        at: now, actorType: 'circle', actorId: 'wallets', verb: 'payment.completed', subjectType: 'payment', subjectId: cur.intentId,
        data: {
          attempt_id: attemptId,
          circle_transaction_id: cur.circleTransactionId,
          tx_hash: tx.txHash ?? null,
          fee: tx.feeUsdc ?? null,
          amount: toUsdc6(intent!.amount),
          explorer_url: tx.txHash ? explorerTxUrl(cfg, tx.txHash) : null,
        },
      });
    } else if (FAILED_STATES.includes(tx.state)) {
      // Terminal. Never retried automatically: a retry is a new request, classified again.
      await setIntentStatus(t, cur.intentId, intent!.status as 'SUBMITTED', 'FAILED', {}, now);
      await appendAudit(t, cfg.orgId, {
        at: now, actorType: 'circle', actorId: 'wallets', verb: 'payment.failed', subjectType: 'payment', subjectId: cur.intentId,
        data: { attempt_id: attemptId, circle_transaction_id: cur.circleTransactionId, state: tx.state, error: tx.errorReason ?? null },
      });
    }
  });
  if (tx.state === 'COMPLETE') {
    await deps.jobs.send('balance.refresh', {});
    return null;
  }
  if (FAILED_STATES.includes(tx.state)) return null;
  const age = now.getTime() - (att.submittedAt ?? att.createdAt).getTime();
  if (age > 10 * 60_000) return null; // the sweeper hands long waits to a person via the dashboard
  return age < 15_000 ? 1 : 5;
}

/**
 * attempt.reconcile for UNCONFIRMED attempts: (a) look for our refId at Circle; (b) after the resubmit
 * window, replay createTransaction with the SAME idempotency key; (c) after maxTries, a person decides.
 */
export async function reconcileAttempt(deps: ExecutorDeps, attemptId: string): Promise<'found' | 'resubmitted' | 'waiting' | 'needs_human' | 'skip'> {
  const { db, cfg, circle } = deps;
  const policy = deps.reconcile ?? DEFAULT_RECONCILE;
  const [att] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!att || att.state !== 'UNCONFIRMED') return 'skip';
  const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, att.intentId));
  const mandate = await getActiveMandate(db, cfg.orgId);
  const since = new Date((att.submittedAt ?? att.createdAt).getTime() - 60_000);
  const now = nowOf(deps);

  const txs = await circle.listTransactions({ walletId: mandate!.source_wallet.circle_wallet_id, destinationAddress: intent!.destinationAddress!, from: since, amount: toUsdc6(intent!.amount) });
  const match = txs.find((t) => t.refId === intent!.id && (!t.amounts?.[0] || compareUsdc(toUsdc6(t.amounts[0]), toUsdc6(intent!.amount)) === 0));
  if (match) {
    await db.transaction(async (t) => {
      await t.update(attempts).set({ circleTransactionId: match.id, state: match.state === 'COMPLETE' ? 'CONFIRMED' : match.state }).where(eq(attempts.id, attemptId));
      await setIntentStatus(t, intent!.id, 'UNCONFIRMED', 'SUBMITTED', {}, now);
      await audit(t, deps, now, 'reconcile.found', intent!.id, { attempt_id: attemptId, circle_transaction_id: match.id, state: match.state });
    });
    await deps.jobs.send('attempt.poll', { attemptId }, { startAfterSeconds: 1 });
    return 'found';
  }

  await db.update(attempts).set({ lastPolledAt: now }).where(eq(attempts.id, attemptId));
  const age = now.getTime() - (att.submittedAt ?? att.createdAt).getTime();
  if (age < policy.resubmitAfterMs) {
    await deps.jobs.send('attempt.reconcile', { attemptId }, { startAfterSeconds: policy.retryDelaySeconds });
    return 'waiting';
  }
  if (att.reconcileCount >= policy.maxTries) {
    await db.transaction(async (t) => {
      await t.update(attempts).set({ state: 'NEEDS_HUMAN' }).where(eq(attempts.id, attemptId));
      await setIntentStatus(t, intent!.id, 'UNCONFIRMED', 'NEEDS_HUMAN', {}, now);
      await audit(t, deps, now, 'reconcile.needs_human', intent!.id, { attempt_id: attemptId, resubmits: att.reconcileCount });
    });
    return 'needs_human';
  }
  const tries = att.reconcileCount + 1;
  await db.transaction(async (t) => {
    await t.update(attempts).set({ reconcileCount: tries }).where(eq(attempts.id, attemptId));
    await audit(t, deps, now, 'reconcile.resubmitted', intent!.id, { attempt_id: attemptId, idempotency_key: att.circleIdempotencyKey, try: tries });
  });
  const r = await submitAttempt(deps, attemptId);
  return r.kind === 'submitted' ? 'resubmitted' : 'waiting';
}

/** balance.refresh: one USDC balance, read through Circle and snapshotted for the dashboard and request-time checks. */
export async function refreshBalance(deps: ExecutorDeps, source: 'poll' | 'post_tx' | 'boot' = 'post_tx'): Promise<string | null> {
  const mandate = await getActiveMandate(deps.db, deps.cfg.orgId);
  if (!mandate) return null;
  const walletId = mandate.source_wallet.circle_wallet_id;
  const balance = await deps.circle.getUsdcBalance(walletId);
  const dest = mandate.payees[0]?.address;
  const fee = dest ? await deps.circle.estimateTransferFee({ walletId, destinationAddress: dest, amount: '0.010000' }).catch(() => null) : null;
  await deps.db.insert(balanceSnapshots).values({
    id: newId('bal'),
    orgId: deps.cfg.orgId,
    walletId,
    usdcAmount: balance,
    feeEstimate: fee ?? deps.cfg.defaultFeeEstimateUsdc,
    takenAt: nowOf(deps),
    source,
  });
  return balance;
}

/**
 * Safety net run every few seconds: re-queues QUEUED intents a lost job left behind, turns attempts
 * stuck in PENDING_SUBMIT (crash between commit and the Circle call) into UNCONFIRMED for reconcile,
 * and re-polls submitted attempts nobody is watching.
 */
export async function sweep(deps: ExecutorDeps): Promise<{ requeued: number; unconfirmed: number; repolled: number }> {
  const { db, cfg } = deps;
  const now = nowOf(deps);
  const stale = new Date(now.getTime() - 15_000);
  const queued = await db
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.orgId, cfg.orgId), eq(paymentIntents.status, 'QUEUED'), lt(paymentIntents.updatedAt, stale)));
  for (const q of queued) await deps.jobs.send('payment.execute', { intentId: q.id }, { singletonKey: q.id });

  const pending = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.orgId, cfg.orgId), eq(attempts.state, 'PENDING_SUBMIT'), lt(attempts.createdAt, stale)));
  for (const p of pending) {
    await db.transaction(async (t) => {
      const upd = await t
        .update(attempts)
        .set({ state: 'UNCONFIRMED', submittedAt: p.createdAt })
        .where(and(eq(attempts.id, p.id), eq(attempts.state, 'PENDING_SUBMIT')))
        .returning({ id: attempts.id });
      if (!upd.length) return;
      await setIntentStatus(t, p.intentId, 'SUBMITTED', 'UNCONFIRMED', {}, now);
      await audit(t, deps, now, 'attempt.unconfirmed', p.intentId, { attempt_id: p.id, error_code: 'no_submit_recorded' });
    });
    await deps.jobs.send('attempt.reconcile', { attemptId: p.id });
  }

  const watching = await db
    .select({ id: attempts.id, state: attempts.state })
    .from(attempts)
    .where(
      and(
        eq(attempts.orgId, cfg.orgId),
        inArray(attempts.state, ['INITIATED', 'CLEARED', 'QUEUED', 'SENT', 'CONFIRMED', 'STUCK', 'UNCONFIRMED']),
        or(lt(attempts.lastPolledAt, stale), sql`${attempts.lastPolledAt} is null`),
        lt(attempts.createdAt, stale),
      ),
    );
  for (const w of watching) {
    await deps.jobs.send(w.state === 'UNCONFIRMED' ? 'attempt.reconcile' : 'attempt.poll', { attemptId: w.id }, { singletonKey: w.id });
  }
  return { requeued: queued.length, unconfirmed: pending.length, repolled: watching.length };
}

function audit(tx: Tx, deps: CoreDeps, at: Date, verb: string, intentId: string, data: Record<string, unknown>) {
  return appendAudit(tx, deps.cfg.orgId, { at, actorType: 'system', actorId: 'executor', verb, subjectType: 'payment', subjectId: intentId, data });
}
