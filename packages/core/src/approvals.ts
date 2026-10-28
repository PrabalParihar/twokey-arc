import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import { approvals, paymentIntents, type DbOrTx, type Tx } from '@twokey-arc/db';
import { classify, ENGINE_VERSION, type Mandate, type PayAction, type Verdict } from '@twokey-arc/policy';
import { addUsdc, isUsdcString, toUsdc6 } from '@twokey-arc/money';
import { buildBoundTerms, canonicalTerms, diffTerms, sealTerms, type BoundTerms } from '@twokey-arc/seal';
import { newId, newNonce, nowOf, TwokeyError, type CoreConfig, type CoreDeps } from './base';
import { appendAudit } from './audit';
import { getActiveMandate } from './mandate';
import { autoSpentToday, latestBalance, lockOrg, setIntentStatus } from './state';

export type IntentRow = typeof paymentIntents.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;

/** The PAY action as it will be sent: the request's payee reference with the destination frozen. */
export function actionFromIntent(i: IntentRow): PayAction {
  const ref = i.payeeRef as { payeeId?: string; name?: string };
  return {
    type: 'PAY',
    payee: {
      ...(ref.payeeId ? { payeeId: ref.payeeId } : {}),
      ...(ref.name ? { name: ref.name } : {}),
      ...(i.destinationAddress ? { address: i.destinationAddress } : {}),
    },
    amount: toUsdc6(i.amount),
    ...(i.destinationNetwork ? { network: i.destinationNetwork } : {}),
    ...(i.memo ? { memo: i.memo } : {}),
  };
}

/** Terms rebuilt from the intent as it stands now, keeping the approval's own nonce, expiry and policy context. */
export function termsFromIntent(i: IntentRow, mandate: Mandate, cfg: CoreConfig, ctx: Pick<BoundTerms, 'policy' | 'expires_at' | 'nonce'>): BoundTerms {
  return buildBoundTerms({
    orgId: i.orgId,
    intentId: i.id,
    network: i.destinationNetwork ?? cfg.network,
    chainId: cfg.chainId,
    token: cfg.usdcAddress,
    amount: toUsdc6(i.amount),
    sourceWallet: mandate.source_wallet.address,
    payee: { payeeId: i.resolvedPayeeId, name: i.payeeName, address: i.destinationAddress ?? '' },
    memo: i.memo,
    policy: {
      engineVersion: ctx.policy.engine_version,
      mandateVersion: ctx.policy.mandate_version,
      rule: ctx.policy.rule,
      failedChecks: ctx.policy.failed_checks,
    },
    agentId: i.agentId,
    expiresAt: new Date(ctx.expires_at),
    nonce: ctx.nonce,
  });
}

/** Opens a PENDING approval sealed to the intent's exact terms. Caller holds the org lock. */
export async function openApproval(tx: Tx, cfg: CoreConfig, intent: IntentRow, verdict: Verdict, mandate: Mandate, now: Date): Promise<ApprovalRow> {
  const expiresAt = new Date(now.getTime() + mandate.approval.ttl_minutes * 60_000);
  const terms = termsFromIntent(intent, mandate, cfg, {
    policy: {
      engine_version: ENGINE_VERSION,
      mandate_version: mandate.version,
      rule: verdict.ruleId,
      failed_checks: verdict.checks.filter((c) => !c.pass).map((c) => c.id),
    },
    expires_at: expiresAt.toISOString(),
    nonce: newNonce(),
  });
  const seal = sealTerms(terms);
  const [row] = await tx
    .insert(approvals)
    .values({
      id: newId('apr'),
      orgId: cfg.orgId,
      intentId: intent.id,
      seal,
      boundTerms: terms,
      boundTermsCanonical: canonicalTerms(terms),
      status: 'PENDING',
      expiresAt: new Date(terms.expires_at),
      nonce: terms.nonce,
    })
    .returning();
  await appendAudit(tx, cfg.orgId, {
    at: now,
    actorType: 'system',
    actorId: 'policy',
    verb: 'approval.requested',
    subjectType: 'approval',
    subjectId: row!.id,
    data: { intent_id: intent.id, seal, rule: verdict.ruleId, failed_checks: terms.policy.failed_checks, expires_at: terms.expires_at },
  });
  return row!;
}

export type VoidReason = 'terms_changed' | 'expired' | 'precondition_failed' | 'mandate_changed' | 'cancelled';

/** Voids an open approval and the intent with it. Every void is audited with its reason. */
export async function voidApproval(
  tx: Tx,
  cfg: CoreConfig,
  a: ApprovalRow,
  intent: IntentRow,
  reason: VoidReason,
  detail: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await tx.update(approvals).set({ status: 'VOIDED', voidReason: reason, voidDetail: detail }).where(eq(approvals.id, a.id));
  if (reason !== 'cancelled') {
    await setIntentStatus(tx, intent.id, intent.status as 'QUEUED' | 'AWAITING_APPROVAL', 'VOIDED', {}, now);
  }
  await appendAudit(tx, cfg.orgId, {
    at: now,
    actorType: 'system',
    actorId: 'twokey',
    verb: 'approval.voided',
    subjectType: 'approval',
    subjectId: a.id,
    data: { intent_id: intent.id, reason, ...detail },
  });
}

/** Human-readable drift for the void message: "the amount changed from 0.60 to 1.10". */
export function driftDetail(stored: BoundTerms, rebuilt: BoundTerms): Record<string, unknown> {
  const fields = diffTerms(stored, rebuilt);
  return {
    fields,
    ...(fields.includes('amount') ? { amount_from: stored.amount, amount_to: rebuilt.amount } : {}),
    ...(fields.includes('payee.address') ? { address_from: stored.payee.address, address_to: rebuilt.payee.address } : {}),
  };
}

export interface DecideInput {
  approvalId: string;
  decision: 'approve' | 'reject';
  seal?: string;
  reason?: string;
  by: string;
  via: 'dashboard' | 'telegram' | 'public-demo';
  /** Telegram carries only a seal prefix; the server checks it against the stored seal. */
  sealPrefix?: string;
}

type DecideResult = { ok: true; approval: ApprovalRow; note?: string } | { ok: false; code: string; message: string };

export async function decideApproval(deps: CoreDeps, input: DecideInput): Promise<{ approval: ApprovalRow; note?: string }> {
  const { db, cfg } = deps;
  const now = nowOf(deps);
  const result = await db.transaction(async (tx): Promise<DecideResult> => {
    await lockOrg(tx, cfg.orgId);
    const [a] = await tx.select().from(approvals).where(and(eq(approvals.id, input.approvalId), eq(approvals.orgId, cfg.orgId)));
    if (!a) throw new TwokeyError('not_found', 404, 'approval not found');
    const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, a.intentId));
    if (a.status !== 'PENDING') return { ok: false, code: a.status === 'VOIDED' ? 'voided' : 'not_pending', message: `approval is ${a.status}` };

    if (now.getTime() >= a.expiresAt.getTime()) {
      await tx.update(approvals).set({ status: 'EXPIRED' }).where(eq(approvals.id, a.id));
      await setIntentStatus(tx, intent!.id, 'AWAITING_APPROVAL', 'EXPIRED', {}, now);
      await appendAudit(tx, cfg.orgId, {
        at: now, actorType: 'system', actorId: 'twokey', verb: 'approval.expired', subjectType: 'approval', subjectId: a.id,
        data: { intent_id: a.intentId },
      });
      return { ok: false, code: 'expired', message: 'approval expired; nothing was sent' };
    }

    if (input.decision === 'reject') {
      const reason = input.reason?.trim();
      if (!reason) throw new TwokeyError('reason_required', 400, 'a reason is required to reject');
      const [updated] = await tx
        .update(approvals)
        .set({ status: 'REJECTED', rejectReason: reason, decidedBy: input.by, decidedVia: input.via, decidedAt: now })
        .where(eq(approvals.id, a.id))
        .returning();
      await setIntentStatus(tx, intent!.id, 'AWAITING_APPROVAL', 'REJECTED', {}, now);
      await appendAudit(tx, cfg.orgId, {
        at: now, actorType: 'user', actorId: input.by, verb: 'approval.rejected', subjectType: 'approval', subjectId: a.id,
        data: { intent_id: a.intentId, via: input.via, reason },
      });
      return { ok: true, approval: updated! };
    }

    // The approver must submit the seal they were shown; anything else means they saw other terms.
    const sealOk = input.seal ? input.seal === a.seal : !!input.sealPrefix && a.seal.startsWith(`sha256:${input.sealPrefix}`);
    if (!sealOk) {
      await appendAudit(tx, cfg.orgId, {
        at: now, actorType: 'user', actorId: input.by, verb: 'approval.seal_mismatch', subjectType: 'approval', subjectId: a.id,
        data: { intent_id: a.intentId, via: input.via },
      });
      return { ok: false, code: 'seal_mismatch', message: 'the terms you approved are not the terms on record' };
    }

    const mandate = await getActiveMandate(tx, cfg.orgId);
    const stored = a.boundTerms as BoundTerms;
    if (!mandate) return { ok: false, code: 'no_mandate', message: 'no active mandate' };
    const rebuilt = termsFromIntent(intent!, mandate, cfg, stored);
    if (sealTerms(rebuilt) !== a.seal) {
      await voidApproval(tx, cfg, a, intent!, 'terms_changed', driftDetail(stored, rebuilt), now);
      return { ok: false, code: 'terms_changed', message: 'the payment changed after it was sealed; nothing was sent' };
    }

    // Second classification (PRD §8.3): an invariant may now fail, or the lane may have dropped.
    const bal = await latestBalance(tx, mandate.source_wallet.circle_wallet_id);
    const verdict = classify(
      actionFromIntent(intent!),
      {
        balanceUsdc: bal?.usdc ?? '0.000000',
        feeEstimateUsdc: bal?.fee ?? cfg.defaultFeeEstimateUsdc,
        autoSpentTodayUsdc: await autoSpentToday(tx, cfg.orgId, mandate.timezone, now, intent!.id),
        liveAttemptForIntent: false,
      },
      mandate,
      now,
    );
    if (verdict.lane === 'BREAKS_RULE') {
      await voidApproval(tx, cfg, a, intent!, mandate.version !== stored.policy.mandate_version ? 'mandate_changed' : 'precondition_failed', { rule: verdict.ruleId }, now);
      return { ok: false, code: 'precondition_failed', message: `can no longer be paid: ${verdict.ruleId}` };
    }

    const [updated] = await tx
      .update(approvals)
      .set({ status: 'APPROVED', decidedBy: input.by, decidedVia: input.via, decidedAt: now })
      .where(eq(approvals.id, a.id))
      .returning();
    await setIntentStatus(tx, intent!.id, 'AWAITING_APPROVAL', 'QUEUED', { approved: true }, now);
    await appendAudit(tx, cfg.orgId, {
      at: now, actorType: 'user', actorId: input.by, verb: 'approval.approved', subjectType: 'approval', subjectId: a.id,
      data: { intent_id: a.intentId, seal: a.seal, via: input.via, lane_now: verdict.lane },
    });
    return {
      ok: true,
      approval: updated!,
      ...(verdict.lane === 'INSIDE_MANDATE' ? { note: 'no longer needs your approval; it fits the mandate now' } : {}),
    };
  });

  if (!result.ok) throw new TwokeyError(result.code, result.code === 'reason_required' ? 400 : 409, result.message);
  if (result.approval.status === 'APPROVED') {
    await deps.jobs.send('payment.execute', { intentId: result.approval.intentId }, { startAfterSeconds: cfg.approvalGraceSeconds });
  }
  return { approval: result.approval, ...(result.note ? { note: result.note } : {}) };
}

/** Marks every overdue PENDING approval EXPIRED. Returns how many. */
export async function expireApprovals(deps: CoreDeps): Promise<number> {
  const now = nowOf(deps);
  const due = await deps.db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.orgId, deps.cfg.orgId), eq(approvals.status, 'PENDING'), lte(approvals.expiresAt, now)));
  let n = 0;
  for (const { id } of due) {
    await deps.db.transaction(async (tx) => {
      await lockOrg(tx, deps.cfg.orgId);
      const [a] = await tx.select().from(approvals).where(eq(approvals.id, id));
      if (a?.status !== 'PENDING') return;
      await tx.update(approvals).set({ status: 'EXPIRED' }).where(eq(approvals.id, id));
      await setIntentStatus(tx, a.intentId, 'AWAITING_APPROVAL', 'EXPIRED', {}, now);
      await appendAudit(tx, deps.cfg.orgId, {
        at: now, actorType: 'system', actorId: 'twokey', verb: 'approval.expired', subjectType: 'approval', subjectId: id,
        data: { intent_id: a.intentId },
      });
      n++;
    });
  }
  return n;
}

/**
 * Demo only (DEMO_MODE): the agent re-rounds the amount after the owner saw or approved it.
 * The seal no longer matches, so the approval voids and nothing is sent.
 */
export async function driftDemo(deps: CoreDeps, intentId: string, delta = '0.50'): Promise<{ from: string; to: string }> {
  if (!deps.cfg.demoMode) throw new TwokeyError('not_found', 404, 'not found');
  if (!isUsdcString(delta)) throw new TwokeyError('invalid_request', 400, 'delta must be a USDC amount');
  const now = nowOf(deps);
  return deps.db.transaction(async (tx) => {
    await lockOrg(tx, deps.cfg.orgId);
    const [i] = await tx.select().from(paymentIntents).where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.orgId, deps.cfg.orgId)));
    const open = i && (i.status === 'AWAITING_APPROVAL' || (i.status === 'QUEUED' && i.approved));
    if (!open) throw new TwokeyError('not_driftable', 409, 'only a payment waiting for, or holding, an approval can drift');
    const from = toUsdc6(i.amount);
    const to = addUsdc(from, delta);
    await tx.update(paymentIntents).set({ amount: to, updatedAt: now }).where(eq(paymentIntents.id, intentId));
    await appendAudit(tx, deps.cfg.orgId, {
      at: now, actorType: 'agent', actorId: i.agentId, verb: 'demo.drift', subjectType: 'payment', subjectId: intentId,
      data: { amount_from: from, amount_to: to },
    });
    return { from, to };
  });
}

export async function getApproval(db: DbOrTx, orgId: string, id: string): Promise<{ approval: ApprovalRow; intent: IntentRow } | null> {
  const [a] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.orgId, orgId)));
  if (!a) return null;
  const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, a.intentId));
  return { approval: a, intent: intent! };
}

export async function listApprovals(db: DbOrTx, orgId: string, status?: ApprovalRow['status']) {
  const rows = await db
    .select({ approval: approvals, intent: paymentIntents })
    .from(approvals)
    .innerJoin(paymentIntents, eq(paymentIntents.id, approvals.intentId))
    .where(and(eq(approvals.orgId, orgId), status ? eq(approvals.status, status) : undefined))
    .orderBy(status === 'PENDING' ? asc(approvals.createdAt) : desc(approvals.createdAt))
    .limit(100);
  return rows;
}

export async function approvalsForIntents(db: DbOrTx, intentIds: string[]): Promise<ApprovalRow[]> {
  if (!intentIds.length) return [];
  return db.select().from(approvals).where(inArray(approvals.intentId, intentIds)).orderBy(desc(approvals.createdAt));
}
