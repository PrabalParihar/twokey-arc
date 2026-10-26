import { and, asc, desc, eq, gt, or, sql } from 'drizzle-orm';
import { auditLog, type DbOrTx, type Tx } from '@twokey-arc/db';
import { chainNext, verifyAuditChain, type ActorType, type AuditEntry, type ChainVerdict } from '@twokey-arc/seal';
import { jsonClean } from './base';

export interface AuditInput {
  at: Date;
  actorType: ActorType;
  actorId: string;
  verb: string;
  subjectType: string;
  subjectId: string;
  data: Record<string, unknown>;
}

/** Serializes appends per org and links each entry to the previous one, inside the caller's transaction. */
export async function appendAudit(tx: Tx, orgId: string, input: AuditInput): Promise<AuditEntry> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`audit:${orgId}`}))`);
  const [last] = await tx
    .select({ seq: auditLog.seq, entry_hash: auditLog.entryHash })
    .from(auditLog)
    .where(eq(auditLog.orgId, orgId))
    .orderBy(desc(auditLog.seq))
    .limit(1);
  const entry = chainNext(last ?? null, {
    at: input.at.toISOString(),
    actor_type: input.actorType,
    actor_id: input.actorId,
    verb: input.verb,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    data: jsonClean(input.data),
  });
  await tx.insert(auditLog).values({
    seq: entry.seq,
    orgId,
    at: input.at,
    actorType: entry.actor_type,
    actorId: entry.actor_id,
    verb: entry.verb,
    subjectType: entry.subject_type,
    subjectId: entry.subject_id,
    data: entry.data,
    prevHash: entry.prev_hash,
    entryHash: entry.entry_hash,
  });
  return entry;
}

type AuditRow = typeof auditLog.$inferSelect;

export const rowToEntry = (r: AuditRow): AuditEntry => ({
  seq: r.seq,
  at: r.at.toISOString(),
  actor_type: r.actorType,
  actor_id: r.actorId,
  verb: r.verb,
  subject_type: r.subjectType,
  subject_id: r.subjectId,
  data: r.data as Record<string, unknown>,
  prev_hash: r.prevHash,
  entry_hash: r.entryHash,
});

export async function listAudit(db: DbOrTx, orgId: string, opts: { after?: number; limit?: number } = {}): Promise<AuditEntry[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.orgId, orgId), opts.after ? gt(auditLog.seq, opts.after) : undefined))
    .orderBy(asc(auditLog.seq))
    .limit(opts.limit ?? 10_000);
  return rows.map(rowToEntry);
}

/** Recomputes the whole chain from the stored rows. */
export async function verifyAudit(db: DbOrTx, orgId: string): Promise<ChainVerdict> {
  const rows = await db.select().from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(asc(auditLog.seq));
  return verifyAuditChain(rows.map(rowToEntry));
}

/** Every entry about one payment: its own verbs and its approval's, in chain order. */
export async function auditForPayment(db: DbOrTx, orgId: string, intentId: string): Promise<AuditEntry[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.orgId, orgId), or(eq(auditLog.subjectId, intentId), sql`${auditLog.data}->>'intent_id' = ${intentId}`)))
    .orderBy(asc(auditLog.seq));
  return rows.map(rowToEntry);
}
