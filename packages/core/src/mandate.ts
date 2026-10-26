import { and, eq, sql } from 'drizzle-orm';
import { mandates, payees, type DbOrTx, type Tx } from '@twokey-arc/db';
import { MandateDocument } from '@twokey-arc/contracts';
import type { Mandate } from '@twokey-arc/policy';
import { isoSeconds, payeeFingerprint, sealOf } from '@twokey-arc/seal';
import { toUsdc6 } from '@twokey-arc/money';
import { newId, TwokeyError } from './base';
import { appendAudit } from './audit';

export async function getActiveMandate(db: DbOrTx, orgId: string): Promise<Mandate | null> {
  const [row] = await db
    .select({ document: mandates.document })
    .from(mandates)
    .where(and(eq(mandates.orgId, orgId), eq(mandates.status, 'ACTIVE')))
    .limit(1);
  return row ? (row.document as Mandate) : null;
}

export interface MandateDraft {
  network: string;
  chainId: number;
  usdcAddress: string;
  treasury: { walletId: string; address: string };
  timezone: string;
  limits: { per_tx: string; daily: string; hard_max_per_tx: string; min_balance_after: string };
  payees: { payee_id: string; name: string; address: string; per_tx_override?: string | null }[];
  validFrom: Date;
  expiresAt: Date;
  approval: { ttl_minutes: number; telegram: boolean };
  signedBy: string;
}

/** Builds a mandate document and signs it with the seal of its own canonical form. */
export function buildMandate(d: MandateDraft, version: number, signedAt: Date): Mandate {
  const unsigned: Omit<Mandate, 'signature'> = {
    v: 1,
    mandate_id: `mdt_v${version}`,
    version,
    network: d.network,
    chain_id: d.chainId,
    token: { symbol: 'USDC', address: d.usdcAddress, decimals: 6 },
    source_wallet: { circle_wallet_id: d.treasury.walletId, address: d.treasury.address },
    timezone: d.timezone,
    limits: {
      per_tx: toUsdc6(d.limits.per_tx),
      daily: toUsdc6(d.limits.daily),
      hard_max_per_tx: toUsdc6(d.limits.hard_max_per_tx),
      min_balance_after: toUsdc6(d.limits.min_balance_after),
    },
    payees: d.payees.map((p) => ({
      payee_id: p.payee_id,
      name: p.name,
      network: d.network,
      address: p.address,
      fingerprint: payeeFingerprint(d.network, p.address),
      per_tx_override: p.per_tx_override ? toUsdc6(p.per_tx_override) : null,
    })),
    valid_from: isoSeconds(d.validFrom),
    expires_at: isoSeconds(d.expiresAt),
    approval: d.approval,
    signed_by: d.signedBy,
    signed_at: isoSeconds(signedAt),
  };
  return { ...unsigned, signature: sealOf(unsigned) };
}

/** Supersedes the active mandate (if any) and activates `doc`, with its pinned payees, in one transaction. */
export async function activateMandate(tx: Tx, orgId: string, doc: Mandate, actor: { type: 'user' | 'system'; id: string }, now: Date) {
  const parsed = MandateDocument.safeParse(doc);
  if (!parsed.success) throw new TwokeyError('invalid_mandate', 400, 'mandate document is invalid', parsed.error.issues);
  const { signature, ...unsigned } = doc;
  if (sealOf(unsigned) !== signature) throw new TwokeyError('invalid_mandate', 400, 'mandate signature does not match its content');

  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`org:${orgId}`}))`);
  const prev = await getActiveMandate(tx, orgId);
  if (prev && doc.version <= prev.version) throw new TwokeyError('stale_mandate', 409, `version must be above ${prev.version}`);
  await tx.update(mandates).set({ status: 'SUPERSEDED' }).where(and(eq(mandates.orgId, orgId), eq(mandates.status, 'ACTIVE')));
  await tx.insert(mandates).values({
    id: newId('mdt'),
    orgId,
    version: doc.version,
    document: doc,
    documentHash: signature,
    status: 'ACTIVE',
    activatedAt: now,
  });
  if (doc.payees.length) {
    await tx.insert(payees).values(
      doc.payees.map((p) => ({
        id: newId('pye'),
        orgId,
        payeeId: p.payee_id,
        name: p.name,
        network: p.network,
        address: p.address,
        fingerprint: p.fingerprint,
        mandateVersion: doc.version,
      })),
    );
  }
  await appendAudit(tx, orgId, {
    at: now,
    actorType: actor.type,
    actorId: actor.id,
    verb: 'mandate.activated',
    subjectType: 'mandate',
    subjectId: doc.mandate_id,
    data: {
      version: doc.version,
      document_hash: signature,
      limits: doc.limits,
      payees: doc.payees.map((p) => ({ payee_id: p.payee_id, address: p.address.toLowerCase() })),
      expires_at: doc.expires_at,
    },
  });
}
