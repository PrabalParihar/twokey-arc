import { and, desc, eq, inArray } from 'drizzle-orm';
import { approvals, attempts, paymentIntents, type DbOrTx } from '@twokey-arc/db';
import { PaymentRequest, type IntentStatus, type PaymentResponse } from '@twokey-arc/contracts';
import { classify, type Check, type PayAction } from '@twokey-arc/policy';
import { isUsdcString, toUsdc6 } from '@twokey-arc/money';
import { sealOf } from '@twokey-arc/seal';
import { explorerTxUrl, jsonClean, newId, nowOf, TwokeyError, type CoreConfig, type CoreDeps } from './base';
import { appendAudit } from './audit';
import { getActiveMandate } from './mandate';
import { autoSpentToday, latestBalance, lockOrg, setIntentStatus } from './state';
import { openApproval, voidApproval, type ApprovalRow, type IntentRow } from './approvals';

type AttemptRow = typeof attempts.$inferSelect;

export function toResponse(cfg: CoreConfig, i: IntentRow, a?: ApprovalRow | null, at?: AttemptRow | null): PaymentResponse {
  return {
    paymentId: i.id,
    outcome: i.outcome as PaymentResponse['outcome'],
    lane: i.lane as PaymentResponse['lane'],
    ruleId: i.ruleId,
    checks: i.checks as Check[],
    status: i.status as IntentStatus,
    amount: toUsdc6(i.amount),
    payee: { payeeId: i.resolvedPayeeId, name: i.payeeName, address: i.destinationAddress },
    memo: i.memo,
    ...(a ? { approval: { id: a.id, status: a.status, expiresAt: a.expiresAt.toISOString() } } : {}),
    ...(at?.circleTransactionId ? { circleTransactionId: at.circleTransactionId } : {}),
    ...(at?.txHash ? { txHash: at.txHash, explorerUrl: explorerTxUrl(cfg, at.txHash) } : {}),
    createdAt: i.createdAt.toISOString(),
  };
}

export interface RequestPaymentInput {
  agentId: string;
  idempotencyKey: string | null | undefined;
  body: unknown;
}

/**
 * POST /api/v1/payments. Classifies, records the intent and its audit trail in one transaction,
 * opens a sealed approval when the request adds risk, and only then queues execution.
 */
export async function requestPayment(deps: CoreDeps, input: RequestPaymentInput): Promise<{ response: PaymentResponse; replayed: boolean }> {
  const { db, cfg } = deps;
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    throw new TwokeyError('idempotency_key_required', 400, 'Idempotency-Key header (8-128 chars) is required');
  }
  const parsed = PaymentRequest.safeParse(input.body);
  if (!parsed.success) throw new TwokeyError('invalid_request', 400, 'request body is invalid', parsed.error.issues);
  const body = parsed.data;
  const requestHash = sealOf(jsonClean({ ...body, amount: isUsdcString(body.amount) ? toUsdc6(body.amount) : body.amount }));
  const now = nowOf(deps);

  const out = await db.transaction(async (tx) => {
    await lockOrg(tx, cfg.orgId);
    const [existing] = await tx
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.agentId, input.agentId), eq(paymentIntents.idempotencyKey, key)));
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new TwokeyError('idempotency_key_reused', 409, 'this Idempotency-Key was used for a different request');
      }
      return { intent: existing, approval: null, replayed: true };
    }

    const mandate = await getActiveMandate(tx, cfg.orgId);
    const bal = mandate ? await latestBalance(tx, mandate.source_wallet.circle_wallet_id) : null;
    const state = {
      balanceUsdc: bal?.usdc ?? '0.000000',
      feeEstimateUsdc: bal?.fee ?? cfg.defaultFeeEstimateUsdc,
      autoSpentTodayUsdc: mandate ? await autoSpentToday(tx, cfg.orgId, mandate.timezone, now) : '0.000000',
      liveAttemptForIntent: false,
    };
    const action: PayAction = {
      type: 'PAY',
      payee: body.payee,
      amount: body.amount,
      ...(body.network ? { network: body.network } : {}),
      ...(body.memo ? { memo: body.memo } : {}),
    };
    const verdict = classify(action, state, mandate, now);
    const status: IntentStatus =
      verdict.lane === 'BREAKS_RULE' ? 'BLOCKED' : verdict.lane === 'ADDS_RISK' ? 'AWAITING_APPROVAL' : 'QUEUED';

    const [intent] = await tx
      .insert(paymentIntents)
      .values({
        id: newId('pi'),
        orgId: cfg.orgId,
        agentId: input.agentId,
        idempotencyKey: key,
        requestHash,
        payeeRef: jsonClean(body.payee),
        resolvedPayeeId: verdict.payee?.payeeId ?? null,
        payeeName: verdict.payee?.name ?? body.payee.name ?? null,
        destinationNetwork: verdict.payee?.network ?? null,
        destinationAddress: verdict.payee?.address ?? null,
        amount: toUsdc6(body.amount),
        memo: body.memo ?? null,
        lane: verdict.lane,
        ruleId: verdict.ruleId,
        checks: verdict.checks,
        outcome: verdict.outcome,
        status,
        mandateVersion: mandate?.version ?? null,
        stateSnapshot: state,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await appendAudit(tx, cfg.orgId, {
      at: now, actorType: 'agent', actorId: input.agentId, verb: 'payment.requested', subjectType: 'payment', subjectId: intent!.id,
      data: { amount: intent!.amount, payee: jsonClean(body.payee), memo: body.memo ?? null, idempotency_key: key },
    });
    await appendAudit(tx, cfg.orgId, {
      at: now, actorType: 'system', actorId: 'policy', verb: 'policy.classified', subjectType: 'payment', subjectId: intent!.id,
      data: {
        stage: 'request',
        lane: verdict.lane,
        rule: verdict.ruleId,
        failed_checks: verdict.checks.filter((c) => !c.pass).map((c) => c.id),
        mandate_version: mandate?.version ?? null,
        state_hash: sealOf(state),
      },
    });
    const approval = verdict.lane === 'ADDS_RISK' && mandate ? await openApproval(tx, cfg, intent!, verdict, mandate, now) : null;
    return { intent: intent!, approval, replayed: false };
  });

  if (!out.replayed) {
    if (out.intent.status === 'QUEUED') await deps.jobs.send('payment.execute', { intentId: out.intent.id }, { singletonKey: out.intent.id });
    if (out.approval) await deps.jobs.send('approval.notify', { approvalId: out.approval.id });
  }
  const full = await getPayment(db, cfg, out.intent.id);
  return { response: full!, replayed: out.replayed };
}

export async function getPayment(db: DbOrTx, cfg: CoreConfig, id: string, agentId?: string): Promise<PaymentResponse | null> {
  const [i] = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.id, id), eq(paymentIntents.orgId, cfg.orgId), agentId ? eq(paymentIntents.agentId, agentId) : undefined));
  if (!i) return null;
  const [a] = await db.select().from(approvals).where(eq(approvals.intentId, id)).orderBy(desc(approvals.createdAt)).limit(1);
  const [at] = await db.select().from(attempts).where(eq(attempts.intentId, id)).orderBy(desc(attempts.createdAt)).limit(1);
  return toResponse(cfg, i, a, at);
}

export interface TimelineRow {
  intent: IntentRow;
  approval: ApprovalRow | null;
  attempt: AttemptRow | null;
}

export async function listPayments(db: DbOrTx, orgId: string, opts: { status?: string; limit?: number } = {}): Promise<TimelineRow[]> {
  const intents = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.orgId, orgId), opts.status ? eq(paymentIntents.status, opts.status) : undefined))
    .orderBy(desc(paymentIntents.createdAt))
    .limit(opts.limit ?? 50);
  const ids = intents.map((i) => i.id);
  const aps = ids.length ? await db.select().from(approvals).where(inArray(approvals.intentId, ids)).orderBy(desc(approvals.createdAt)) : [];
  const ats = ids.length ? await db.select().from(attempts).where(inArray(attempts.intentId, ids)).orderBy(desc(attempts.createdAt)) : [];
  return intents.map((intent) => ({
    intent,
    approval: aps.find((a) => a.intentId === intent.id) ?? null,
    attempt: ats.find((a) => a.intentId === intent.id) ?? null,
  }));
}

/** Lowers risk: allowed only before anything is handed to Circle. */
export async function cancelPayment(deps: CoreDeps, input: { intentId: string; actor: { type: 'agent' | 'user'; id: string }; agentId?: string }) {
  const { db, cfg } = deps;
  const now = nowOf(deps);
  await db.transaction(async (tx) => {
    await lockOrg(tx, cfg.orgId);
    const [i] = await tx
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.id, input.intentId), eq(paymentIntents.orgId, cfg.orgId), input.agentId ? eq(paymentIntents.agentId, input.agentId) : undefined));
    if (!i) throw new TwokeyError('not_found', 404, 'payment not found');
    const verdict = classify({ type: 'CANCEL_PAYMENT', intentStatus: i.status }, { balanceUsdc: '0', feeEstimateUsdc: '0', autoSpentTodayUsdc: '0', liveAttemptForIntent: false }, null, now);
    if (verdict.lane === 'BREAKS_RULE') throw new TwokeyError('not_cancellable', 409, verdict.checks[0]!.detail);
    const [open] = await tx.select().from(approvals).where(and(eq(approvals.intentId, i.id), inArray(approvals.status, ['PENDING', 'APPROVED'])));
    if (open) await voidApproval(tx, cfg, open, i, 'cancelled', { by: input.actor.id }, now);
    await setIntentStatus(tx, i.id, i.status as IntentStatus, 'CANCELLED', {}, now);
    await appendAudit(tx, cfg.orgId, {
      at: now, actorType: input.actor.type, actorId: input.actor.id, verb: 'payment.cancelled', subjectType: 'payment', subjectId: i.id,
      data: { from_status: i.status, rule: verdict.ruleId },
    });
  });
  return getPayment(db, cfg, input.intentId);
}
