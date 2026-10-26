import { toUsdc6 } from '@twokey-arc/money';
import { canonicalize, isoSeconds, payeeFingerprint, sealOf } from './hash';

/** Everything a human approves. Any change to any field changes the seal. The balance is deliberately absent. */
export interface BoundTerms {
  v: 1;
  org_id: string;
  intent_id: string;
  action: 'PAY';
  network: string;
  chain_id: number;
  token: string;
  amount: string;
  source_wallet: string;
  payee: { payee_id: string | null; name: string | null; address: string; fingerprint: string };
  memo: string | null;
  policy: { engine_version: string; mandate_version: number; rule: string; failed_checks: string[] };
  agent_id: string;
  expires_at: string;
  nonce: string;
}

export interface BoundTermsInput {
  orgId: string;
  intentId: string;
  network: string;
  chainId: number;
  token: string;
  amount: string;
  sourceWallet: string;
  payee: { payeeId: string | null; name: string | null; address: string };
  memo: string | null;
  policy: { engineVersion: string; mandateVersion: number; rule: string; failedChecks: string[] };
  agentId: string;
  expiresAt: Date;
  nonce: string;
}

/**
 * Builds terms in their one canonical form: amounts as 6-dp strings, addresses lowercased,
 * timestamps at second precision, set-like arrays sorted. Two callers that agree on the facts
 * always get byte-identical terms, which is what lets the executor recompute the seal.
 */
export function buildBoundTerms(i: BoundTermsInput): BoundTerms {
  const address = i.payee.address.toLowerCase();
  return {
    v: 1,
    org_id: i.orgId,
    intent_id: i.intentId,
    action: 'PAY',
    network: i.network,
    chain_id: i.chainId,
    token: i.token.toLowerCase(),
    amount: toUsdc6(i.amount),
    source_wallet: i.sourceWallet.toLowerCase(),
    payee: {
      payee_id: i.payee.payeeId,
      name: i.payee.name,
      address,
      fingerprint: payeeFingerprint(i.network, address),
    },
    memo: i.memo,
    policy: {
      engine_version: i.policy.engineVersion,
      mandate_version: i.policy.mandateVersion,
      rule: i.policy.rule,
      failed_checks: [...i.policy.failedChecks].sort(),
    },
    agent_id: i.agentId,
    expires_at: isoSeconds(i.expiresAt),
    nonce: i.nonce,
  };
}

export const sealTerms = (t: BoundTerms): string => sealOf(t);
export const canonicalTerms = (t: BoundTerms): string => canonicalize(t);

/** Names of top-level (and payee/policy) fields that differ, for a readable void reason. */
export function diffTerms(a: BoundTerms, b: BoundTerms): string[] {
  const flat = (t: BoundTerms): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(t)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = canonicalize(v2 ?? null);
      } else {
        out[k] = canonicalize(v ?? null);
      }
    }
    return out;
  };
  const fa = flat(a);
  const fb = flat(b);
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => fa[k] !== fb[k]).sort();
}
