import 'server-only';
import { and, count, desc, eq } from 'drizzle-orm';
import { attempts, paymentIntents } from '@twokey-arc/db';
import { verifyAudit } from '@twokey-arc/core';
import { cfg, db } from './server';

export interface PublicStats {
  paid: number;
  last: { txHash: string; seconds: number; amount: string; payee: string | null } | null;
  audit: { ok: boolean; length: number };
}

/** Aggregate, read-only numbers for the public landing page. No addresses beyond a tx hash, no ids. */
export async function publicStats(orgId = cfg.orgId): Promise<PublicStats> {
  const [paidRow] = await db()
    .select({ n: count() })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.orgId, orgId), eq(paymentIntents.status, 'PAID')));
  const [last] = await db()
    .select({ txHash: attempts.txHash, created: paymentIntents.createdAt, updated: paymentIntents.updatedAt, amount: paymentIntents.amount, payee: paymentIntents.payeeName })
    .from(paymentIntents)
    .innerJoin(attempts, eq(attempts.intentId, paymentIntents.id))
    // Latency is measured on payments that ran on their own; an approved one includes a person's wait.
    .where(and(eq(paymentIntents.orgId, orgId), eq(paymentIntents.status, 'PAID'), eq(paymentIntents.approved, false)))
    .orderBy(desc(paymentIntents.updatedAt))
    .limit(1);
  const v = await verifyAudit(db(), orgId);
  return {
    paid: paidRow?.n ?? 0,
    last: last?.txHash
      ? { txHash: last.txHash, seconds: Math.max(0, (last.updated.getTime() - last.created.getTime()) / 1000), amount: last.amount, payee: last.payee }
      : null,
    audit: { ok: v.ok, length: v.length },
  };
}

export interface Receipt {
  at: Date;
  payee: string | null;
  address: string | null;
  amount: string;
  status: string;
  ruleId: string;
  approved: boolean;
  txHash: string | null;
  seconds: number | null;
}

/** The latest decisions, as receipts for the landing page's live tape. Payee names and short hashes only. */
export async function recentReceipts(orgId = cfg.orgId, limit = 6): Promise<Receipt[]> {
  const rows = await db()
    .select({ intent: paymentIntents, txHash: attempts.txHash })
    .from(paymentIntents)
    .leftJoin(attempts, eq(attempts.intentId, paymentIntents.id))
    .where(eq(paymentIntents.orgId, orgId))
    .orderBy(desc(paymentIntents.createdAt))
    .limit(limit);
  return rows.map(({ intent: i, txHash }) => ({
    at: i.createdAt,
    payee: i.payeeName,
    address: i.destinationAddress,
    amount: i.amount,
    status: i.status,
    ruleId: i.ruleId,
    approved: i.approved,
    txHash,
    seconds: i.status === 'PAID' && !i.approved ? (i.updatedAt.getTime() - i.createdAt.getTime()) / 1000 : null,
  }));
}
