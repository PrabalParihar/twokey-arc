import { and, desc, eq, sql } from 'drizzle-orm';
import { balanceSnapshots, paymentIntents, type DbOrTx } from '@twokey-arc/db';
import type { IntentStatus } from '@twokey-arc/contracts';
import { toUsdc6 } from '@twokey-arc/money';
import { TwokeyError } from './base';

/** PRD §7.2. Anything not listed is illegal and throws. */
const TRANSITIONS: Record<IntentStatus, IntentStatus[]> = {
  RECEIVED: ['BLOCKED', 'QUEUED', 'AWAITING_APPROVAL'],
  AWAITING_APPROVAL: ['QUEUED', 'REJECTED', 'EXPIRED', 'VOIDED', 'CANCELLED'],
  // At execute time the lane can rise (needs approval), an invariant can fail (blocked) or the approval can void.
  QUEUED: ['SUBMITTED', 'CANCELLED', 'AWAITING_APPROVAL', 'BLOCKED', 'VOIDED', 'UNCONFIRMED', 'FAILED'],
  SUBMITTED: ['PAID', 'FAILED', 'UNCONFIRMED'],
  UNCONFIRMED: ['SUBMITTED', 'PAID', 'FAILED', 'NEEDS_HUMAN'],
  NEEDS_HUMAN: ['PAID', 'FAILED'],
  BLOCKED: [],
  REJECTED: [],
  EXPIRED: [],
  VOIDED: [],
  CANCELLED: [],
  PAID: [],
  FAILED: [],
};

export const canTransition = (from: IntentStatus, to: IntentStatus): boolean => TRANSITIONS[from].includes(to);

/** Compare-and-set on status; a concurrent change or an illegal move throws instead of overwriting. */
export async function setIntentStatus(
  tx: DbOrTx,
  intentId: string,
  from: IntentStatus,
  to: IntentStatus,
  extra: Partial<typeof paymentIntents.$inferInsert> = {},
  now: Date = new Date(),
): Promise<void> {
  if (!canTransition(from, to)) throw new TwokeyError('illegal_transition', 409, `${from} -> ${to} is not allowed`);
  const res = await tx
    .update(paymentIntents)
    .set({ ...extra, status: to, updatedAt: now })
    .where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.status, from)))
    .returning({ id: paymentIntents.id });
  if (res.length !== 1) throw new TwokeyError('status_conflict', 409, `payment ${intentId} is no longer ${from}`);
}

const IN_FLIGHT_OR_PAID = ['QUEUED', 'SUBMITTED', 'PAID', 'UNCONFIRMED', 'NEEDS_HUMAN'];

/**
 * Sum of today's payments that run without an approval, paid or still in flight.
 * "Today" is the local day in the mandate's timezone; approved payments are excluded (PRD §8.2).
 */
export async function autoSpentToday(db: DbOrTx, orgId: string, timezone: string, now: Date, excludeIntentId?: string): Promise<string> {
  const result = await db.execute<{ total: string }>(sql`
    select coalesce(sum(amount), 0)::text as total from payment_intents
    where org_id = ${orgId}
      and approved = false
      and status in (${sql.join(IN_FLIGHT_OR_PAID.map((s) => sql`${s}`), sql`, `)})
      and created_at >= (date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${timezone}) at time zone ${timezone})
      and created_at <  (date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${timezone}) at time zone ${timezone}) + interval '1 day'
      ${excludeIntentId ? sql`and id <> ${excludeIntentId}` : sql``}
  `);
  return toUsdc6(result.rows[0]?.total ?? '0');
}

export async function latestBalance(db: DbOrTx, walletId: string): Promise<{ usdc: string; fee: string | null; takenAt: Date } | null> {
  const [row] = await db
    .select()
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.walletId, walletId))
    .orderBy(desc(balanceSnapshots.takenAt))
    .limit(1);
  return row ? { usdc: toUsdc6(row.usdcAmount), fee: row.feeEstimate ? toUsdc6(row.feeEstimate) : null, takenAt: row.takenAt } : null;
}

export const lockOrg = (db: DbOrTx, orgId: string) => db.execute(sql`select pg_advisory_xact_lock(hashtext(${`org:${orgId}`}))`);
