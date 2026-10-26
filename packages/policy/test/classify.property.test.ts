import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatUsdc6, parseUsdc } from '@twokey-arc/money';
import { classify, laneRank, type Mandate, type PayAction } from '../src';
import { baseMandate, baseState, NOW } from './fixtures';

const micro = (max: number) => fc.bigInt({ min: 0n, max: BigInt(max) * 1_000_000n }).map(formatUsdc6);
const address = fc.string({ unit: fc.constantFrom(...'0123456789abcdefABCDEF'), minLength: 40, maxLength: 40 }).map((h) => `0x${h}`);

const payArb = fc.record({
  amount: micro(1200),
  payee: fc.oneof(
    fc.constant({ payeeId: 'pay_oceanic' }),
    fc.constant({ payeeId: 'pay_harbor' }),
    address.map((a) => ({ address: a })),
  ),
});
const stateArb = fc.record({
  balanceUsdc: micro(500),
  feeEstimateUsdc: micro(1),
  autoSpentTodayUsdc: micro(200),
  liveAttemptForIntent: fc.boolean(),
});
const limitsArb = fc.record({ per_tx: micro(100), daily: micro(300) });

const toAction = (p: { amount: string; payee: PayAction['payee'] }): PayAction => ({ type: 'PAY', ...p });
const withLimits = (l: { per_tx: string; daily: string }): Mandate => {
  const base = baseMandate();
  return baseMandate({ limits: { ...base.limits, ...l } });
};

describe('classify: properties', () => {
  it('P1 deterministic: same input, same verdict', () => {
    fc.assert(
      fc.property(payArb, stateArb, limitsArb, (p, s, l) => {
        const a = classify(toAction(p), s, withLimits(l), NOW);
        const b = classify(toAction(p), s, withLimits(l), NOW);
        expect(a).toEqual(b);
      }),
    );
  });

  it('P2 INSIDE_MANDATE implies every check passed and amount <= per_tx <= hard_max', () => {
    fc.assert(
      fc.property(payArb, stateArb, limitsArb, (p, s, l) => {
        const m = withLimits(l);
        const v = classify(toAction(p), s, m, NOW);
        if (v.lane !== 'INSIDE_MANDATE') return;
        expect(v.checks.every((c) => c.pass)).toBe(true);
        expect(parseUsdc(p.amount) <= parseUsdc(m.limits.per_tx)).toBe(true);
        expect(parseUsdc(p.amount) <= parseUsdc(m.limits.hard_max_per_tx)).toBe(true);
      }),
    );
  });

  it('P3 raising a limit never makes a request stricter; lowering never makes it looser', () => {
    fc.assert(
      fc.property(payArb, stateArb, limitsArb, limitsArb, (p, s, l1, l2) => {
        const min = (a: string, b: string) => (parseUsdc(a) <= parseUsdc(b) ? a : b);
        const max = (a: string, b: string) => (parseUsdc(a) >= parseUsdc(b) ? a : b);
        const tight = classify(toAction(p), s, withLimits({ per_tx: min(l1.per_tx, l2.per_tx), daily: min(l1.daily, l2.daily) }), NOW);
        const loose = classify(toAction(p), s, withLimits({ per_tx: max(l1.per_tx, l2.per_tx), daily: max(l1.daily, l2.daily) }), NOW);
        expect(laneRank(loose.lane)).toBeLessThanOrEqual(laneRank(tight.lane));
      }),
    );
  });

  it('P4 a known payee id at any other address is BREAKS_RULE', () => {
    fc.assert(
      fc.property(address, fc.constantFrom('pay_oceanic', 'pay_harbor'), micro(40), (addr, payeeId, amount) => {
        const m = baseMandate();
        const pinned = m.payees.find((x) => x.payee_id === payeeId)!;
        fc.pre(addr.toLowerCase() !== pinned.address.toLowerCase());
        const v = classify({ type: 'PAY', payee: { payeeId, address: addr }, amount }, baseState(), m, NOW);
        expect(v.lane).toBe('BREAKS_RULE');
      }),
    );
  });
});
