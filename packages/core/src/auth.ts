import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { agents, sessions, users, type Db, type DbOrTx } from '@twokey-arc/db';
import { newId, TwokeyError } from './base';
import { appendAudit } from './audit';

/** Agent keys are stored as HMAC-SHA-256(pepper, key), never in clear. */
export const hashAgentKey = (pepper: string, key: string): string => createHmac('sha256', pepper).update(key).digest('hex');

export async function createAgent(db: DbOrTx, i: { orgId: string; agentId: string; name: string; pepper: string }): Promise<{ apiKey: string }> {
  const apiKey = `tk_agent_${randomBytes(24).toString('base64url')}`;
  await db.insert(agents).values({
    id: newId('agt'),
    orgId: i.orgId,
    agentId: i.agentId,
    name: i.name,
    apiKeyHash: hashAgentKey(i.pepper, apiKey),
    status: 'ACTIVE',
  });
  return { apiKey };
}

export async function authenticateAgent(db: DbOrTx, pepper: string, bearer: string | null | undefined) {
  const key = bearer?.replace(/^Bearer\s+/i, '').trim();
  if (!key?.startsWith('tk_agent_')) return null;
  const [a] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.apiKeyHash, hashAgentKey(pepper, key)), eq(agents.status, 'ACTIVE')));
  return a ?? null;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const SESSION_TTL_MS = 12 * 60 * 60_000;

/** Server-side session: the cookie carries a random id; only its hash is stored. */
export async function createSession(db: DbOrTx, userId: string, now = new Date()): Promise<{ token: string; csrf: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ idHash: sha(token), userId, csrfToken: csrf, expiresAt });
  return { token, csrf, expiresAt };
}

export async function getSession(db: DbOrTx, token: string | null | undefined, now = new Date()) {
  if (!token) return null;
  const [row] = await db
    .select({ user: users, csrf: sessions.csrfToken, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, sha(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
  return row ?? null;
}

export async function revokeSession(db: DbOrTx, token: string, now = new Date()): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.idHash, sha(token)));
}

/** Double-submit check: the header must equal the session's CSRF token. */
export function csrfOk(expected: string, provided: string | null | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Issues a fresh key for an agent, revoking any key it had. The owner does this from the dashboard;
 * the key is returned once and only its HMAC is stored.
 */
export async function issueAgentKey(
  db: Db,
  i: { orgId: string; agentId: string; name: string; pepper: string; by: string; now?: Date },
): Promise<{ apiKey: string }> {
  const now = i.now ?? new Date();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(agents).where(eq(agents.agentId, i.agentId));
    // Agent ids are global; one workspace must never rotate (and so revoke) another workspace's agent.
    if (existing && existing.orgId !== i.orgId) throw new TwokeyError('agent_id_taken', 409, 'this agent id belongs to another workspace');
    if (existing) {
      await tx.update(agents).set({ status: 'REVOKED', agentId: `${i.agentId}-revoked-${now.getTime()}` }).where(eq(agents.id, existing.id));
    }
    const created = await createAgent(tx, { orgId: i.orgId, agentId: i.agentId, name: i.name, pepper: i.pepper });
    await appendAudit(tx, i.orgId, {
      at: now, actorType: 'user', actorId: i.by, verb: 'agent.key_issued', subjectType: 'agent', subjectId: i.agentId,
      data: { replaced_previous: !!existing },
    });
    return created;
  });
}
