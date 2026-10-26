import { describe, expect, it } from 'vitest';
import { classify, type Action, type Lane, type Mandate, type PolicyState } from '../src';
import {
  ATTACKER,
  baseMandate,
  baseState,
  HARBOR,
  NEW_PAYEE,
  NOW,
  OCEANIC,
  payee,
  ZERO,
} from './fixtures';

interface Row {
  n: number;
  name: string;
  action: Action;
  state?: Partial<PolicyState>;
  mandate?: Mandate | null;
  lane: Lane;
  rule: string;
  failed?: string[];
}

const pay = (p: { payeeId?: string; address?: string; name?: string }, amount: string): Action => ({
  type: 'PAY',
  payee: p,
  amount,
});

// PRD §8.4. Written before the engine; every row must hold exactly.
const rows: Row[] = [
  { n: 1, name: 'PAY Oceanic 25.00', action: pay({ payeeId: 'pay_oceanic' }, '25.00'), lane: 'INSIDE_MANDATE', rule: 'R-WM-PAY' },
  { n: 2, name: 'PAY Oceanic 50.00 (boundary)', action: pay({ payeeId: 'pay_oceanic' }, '50.00'), lane: 'INSIDE_MANDATE', rule: 'R-WM-PAY' },
  {
    n: 3,
    name: 'PAY Oceanic 50.000001',
    action: pay({ payeeId: 'pay_oceanic' }, '50.000001'),
    lane: 'ADDS_RISK',
    rule: 'R-EX-PAY',
    failed: ['per_tx_limit'],
  },
  {
    n: 4,
    name: 'PAY Oceanic 40.00 with 120 already auto-spent',
    action: pay({ payeeId: 'pay_oceanic' }, '40.00'),
    state: { autoSpentTodayUsdc: '120.000000' },
    lane: 'ADDS_RISK',
    rule: 'R-EX-PAY',
    failed: ['daily_cap'],
  },
  {
    n: 5,
    name: 'PAY a new address 10.00',
    action: pay({ address: NEW_PAYEE, name: 'Brightline Media' }, '10.00'),
    lane: 'ADDS_RISK',
    rule: 'R-EX-PAY',
    failed: ['payee_known'],
  },
  { n: 6, name: 'PAY "Oceanic" at another address', action: pay({ name: 'Oceanic Freight', address: ATTACKER }, '25.00'), lane: 'BREAKS_RULE', rule: 'INV-PAYEE-PINNED' },
  {
    n: 7,
    name: 'PAY Oceanic 25.00 on an expired mandate',
    action: pay({ payeeId: 'pay_oceanic' }, '25.00'),
    mandate: baseMandate({ expires_at: '2026-10-27T06:00:00Z' }),
    lane: 'ADDS_RISK',
    rule: 'R-EX-PAY',
    failed: ['mandate_active'],
  },
  { n: 8, name: 'PAY Oceanic 1000.01', action: pay({ payeeId: 'pay_oceanic' }, '1000.01'), lane: 'BREAKS_RULE', rule: 'INV-HARD-MAX' },
  { n: 9, name: 'PAY Oceanic 0', action: pay({ payeeId: 'pay_oceanic' }, '0'), lane: 'BREAKS_RULE', rule: 'INV-AMOUNT' },
  { n: 10, name: 'PAY the zero address', action: pay({ address: ZERO }, '10.00'), lane: 'BREAKS_RULE', rule: 'INV-ADDRESS' },
  {
    n: 11,
    name: 'PAY Oceanic 25.00 with balance 20',
    action: pay({ payeeId: 'pay_oceanic' }, '25.00'),
    state: { balanceUsdc: '20.000000' },
    lane: 'BREAKS_RULE',
    rule: 'INV-FUNDS',
  },
  {
    n: 12,
    name: 'PAY Oceanic 25.00 with balance 29 (reserve)',
    action: pay({ payeeId: 'pay_oceanic' }, '25.00'),
    state: { balanceUsdc: '29.000000' },
    lane: 'ADDS_RISK',
    rule: 'R-EX-PAY',
    failed: ['reserve_after'],
  },
  {
    n: 13,
    name: 'PAY Oceanic 25.00 with a live attempt',
    action: pay({ payeeId: 'pay_oceanic' }, '25.00'),
    state: { liveAttemptForIntent: true },
    lane: 'BREAKS_RULE',
    rule: 'INV-DUPLICATE',
  },
  { n: 14, name: 'CANCEL a queued intent', action: { type: 'CANCEL_PAYMENT', intentStatus: 'QUEUED' }, lane: 'LOWERS_RISK', rule: 'R-LR-001' },
  { n: 15, name: 'PAY Oceanic 25.1234567 (7 dp)', action: pay({ payeeId: 'pay_oceanic' }, '25.1234567'), lane: 'BREAKS_RULE', rule: 'INV-AMOUNT' },
  {
    n: 16,
    name: 'UPDATE_MANDATE per_tx 50 -> 30',
    action: { type: 'UPDATE_MANDATE', proposed: baseMandate({ limits: { ...baseMandate().limits, per_tx: '30.000000' } }) },
    lane: 'LOWERS_RISK',
    rule: 'R-LR-001',
  },
  {
    n: 17,
    name: 'UPDATE_MANDATE per_tx 50 -> 80',
    action: { type: 'UPDATE_MANDATE', proposed: baseMandate({ limits: { ...baseMandate().limits, per_tx: '80.000000' } }) },
    lane: 'ADDS_RISK',
    rule: 'R-EX-UPDATE_MANDATE',
    failed: ['mandate.limits.per_tx'],
  },
  {
    n: 18,
    name: 'PAY Harbor 30.00 with per_tx_override 20',
    action: pay({ payeeId: 'pay_harbor' }, '30.00'),
    mandate: baseMandate({
      payees: [payee('pay_oceanic', 'Oceanic Freight', OCEANIC), payee('pay_harbor', 'Harbor Cloud', HARBOR, '20.000000')],
    }),
    lane: 'ADDS_RISK',
    rule: 'R-EX-PAY',
    failed: ['per_tx_limit'],
  },
  { n: 19, name: 'PAY Oceanic 25.00 with no active mandate', action: pay({ payeeId: 'pay_oceanic' }, '25.00'), mandate: null, lane: 'BREAKS_RULE', rule: 'INV-NO-MANDATE' },
];

const OUTCOME = { LOWERS_RISK: 'executed', INSIDE_MANDATE: 'executed', ADDS_RISK: 'pending_approval', BREAKS_RULE: 'blocked' } as const;

describe('classify: PRD §8.4 table', () => {
  it.each(rows)('#$n $name -> $lane / $rule', (row) => {
    const mandate = row.mandate === undefined ? baseMandate() : row.mandate;
    const v = classify(row.action, baseState(row.state), mandate, NOW);
    expect(v.lane).toBe(row.lane);
    expect(v.ruleId).toBe(row.rule);
    expect(v.outcome).toBe(OUTCOME[row.lane]);
    if (row.failed) {
      expect(v.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual(row.failed);
    }
    if (row.lane === 'INSIDE_MANDATE') expect(v.checks.every((c) => c.pass)).toBe(true);
  });
});
