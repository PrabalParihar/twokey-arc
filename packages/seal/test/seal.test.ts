import { describe, expect, it } from 'vitest';
import {
  buildBoundTerms,
  canonicalize,
  chainNext,
  diffTerms,
  GENESIS_HASH,
  isoSeconds,
  payeeFingerprint,
  sealGroups,
  sealOf,
  sealTerms,
  verifyAuditChain,
  type AuditEntry,
  type BoundTermsInput,
} from '../src';

const input: BoundTermsInput = {
  orgId: 'org_demo',
  intentId: 'pi_1',
  network: 'ARC-TESTNET',
  chainId: 5042002,
  token: '0x3600000000000000000000000000000000000000',
  amount: '0.75',
  sourceWallet: '0xAAAA000000000000000000000000000000000001',
  payee: { payeeId: null, name: 'Brightline Media', address: '0xBbBb000000000000000000000000000000000002' },
  memo: 'BM-7',
  policy: { engineVersion: '0.1.0', mandateVersion: 1, rule: 'R-EX-PAY', failedChecks: ['per_tx_limit', 'payee_known'] },
  agentId: 'ap-agent',
  expiresAt: new Date('2026-10-28T10:15:00.123Z'),
  nonce: 'nonce-1',
};

describe('RFC 8785 canonical JSON', () => {
  // Vectors from RFC 8785 §3.2.2 and §3.2.3: key sorting by UTF-16 code units and ES6 number serialization.
  it('sorts keys and strips whitespace', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
  });

  it('serializes numbers the ES6 way', () => {
    expect(canonicalize({ n: [1e21, 0.000001, -0, 4.5] })).toBe('{"n":[1e+21,0.000001,0,4.5]}');
  });

  it('sorts by UTF-16 code units, not locale', () => {
    expect(canonicalize({ '€': 1, '\r': 2, '1': 3 })).toBe('{"\\r":2,"1":3,"€":1}');
  });

  it('refuses bigint so money can never be hashed by accident as a number', () => {
    expect(() => canonicalize({ a: 1n })).toThrow();
  });

  it('throws on undefined at the top level', () => {
    expect(() => canonicalize(undefined)).toThrow(/canonicalizable/);
  });
});

describe('bound terms and seals', () => {
  it('normalizes amounts, addresses, timestamps and check order', () => {
    const t = buildBoundTerms(input);
    expect(t.amount).toBe('0.750000');
    expect(t.payee.address).toBe('0xbbbb000000000000000000000000000000000002');
    expect(t.source_wallet).toBe('0xaaaa000000000000000000000000000000000001');
    expect(t.expires_at).toBe('2026-10-28T10:15:00Z');
    expect(t.policy.failed_checks).toEqual(['payee_known', 'per_tx_limit']);
    expect(t.payee.fingerprint).toBe(payeeFingerprint('ARC-TESTNET', '0xBBBB000000000000000000000000000000000002'));
  });

  it('same facts give the same seal, whatever the input casing or key order', () => {
    const a = sealTerms(buildBoundTerms(input));
    const b = sealTerms(
      buildBoundTerms({
        ...input,
        amount: '0.750000',
        payee: { address: input.payee.address.toUpperCase().replace('0X', '0x'), name: input.payee.name, payeeId: null },
        policy: { ...input.policy, failedChecks: ['payee_known', 'per_tx_limit'] },
      }),
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it.each([
    ['amount', { amount: '0.750001' }],
    ['address', { payee: { ...input.payee, address: '0xBbBb000000000000000000000000000000000003' } }],
    ['network', { network: 'ARC' }],
    ['expiry', { expiresAt: new Date('2026-10-28T10:16:00Z') }],
    ['memo', { memo: 'BM-8' }],
    ['nonce', { nonce: 'nonce-2' }],
  ])('any change to %s changes the seal', (field, change) => {
    const before = buildBoundTerms(input);
    const after = buildBoundTerms({ ...input, ...change } as BoundTermsInput);
    expect(sealTerms(after)).not.toBe(sealTerms(before));
    expect(diffTerms(before, after).length).toBeGreaterThan(0);
  });

  it('names the drifted field', () => {
    const before = buildBoundTerms(input);
    const after = buildBoundTerms({ ...input, amount: '1.25' });
    expect(diffTerms(before, after)).toEqual(['amount']);
    expect(diffTerms(before, before)).toEqual([]);
  });

  it('groups the first 12 hex characters for reading', () => {
    expect(sealGroups('sha256:6e4737737448abcdef')).toBe('6e47 3773 7448');
  });

  it('isoSeconds drops milliseconds', () => {
    expect(isoSeconds(new Date('2026-01-01T00:00:00.999Z'))).toBe('2026-01-01T00:00:00Z');
  });

  it('sealOf matches a known SHA-256 of the canonical form', () => {
    // sha256('{"a":1}')
    expect(sealOf({ a: 1 })).toBe('sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
  });
});

describe('hash-chained audit log', () => {
  const body = (verb: string) => ({
    at: '2026-10-27T10:00:00.000Z',
    actor_type: 'agent' as const,
    actor_id: 'ap-agent',
    verb,
    subject_type: 'payment',
    subject_id: 'pi_1',
    data: { amount: '0.250000' },
  });

  const chain = (): AuditEntry[] => {
    const out: AuditEntry[] = [];
    for (const verb of ['payment.requested', 'policy.classified', 'payment.completed']) {
      out.push(chainNext(out.at(-1) ?? null, body(verb)));
    }
    return out;
  };

  it('starts at the genesis hash and verifies', () => {
    const c = chain();
    expect(c[0]?.prev_hash).toBe(GENESIS_HASH);
    expect(c[1]?.prev_hash).toBe(c[0]?.entry_hash);
    expect(verifyAuditChain(c)).toEqual({ ok: true, length: 3, head: c[2]?.entry_hash });
  });

  it('reports the first broken row when data is edited', () => {
    const c = chain();
    c[1] = { ...c[1]!, data: { amount: '9.990000' } };
    expect(verifyAuditChain(c)).toMatchObject({ ok: false, firstBrokenSeq: 2 });
  });

  it('reports a deleted row', () => {
    const c = chain();
    c.splice(1, 1);
    expect(verifyAuditChain(c)).toMatchObject({ ok: false, firstBrokenSeq: 3 });
  });

  it('reports a relinked row', () => {
    const c = chain();
    c[2] = { ...c[2]!, prev_hash: GENESIS_HASH };
    expect(verifyAuditChain(c)).toMatchObject({ ok: false, firstBrokenSeq: 3 });
  });

  it('an empty chain is trivially ok', () => {
    expect(verifyAuditChain([])).toEqual({ ok: true, length: 0, head: GENESIS_HASH });
  });
});
