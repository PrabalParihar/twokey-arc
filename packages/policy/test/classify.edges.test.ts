import { describe, expect, it } from 'vitest';
import { classify, ENGINE_VERSION, laneRank, outcomeOf, SUPPORTED_NETWORKS, type Mandate } from '../src';
import { baseMandate, baseState, HARBOR, NEW_PAYEE, NOW, OCEANIC, payee, TREASURY } from './fixtures';

const m = baseMandate();
const st = baseState();
const update = (proposed: Mandate) => classify({ type: 'UPDATE_MANDATE', proposed }, st, m, NOW);
const failed = (v: ReturnType<typeof classify>) => v.checks.filter((c) => !c.pass).map((c) => c.id);

describe('PAY: destination invariants', () => {
  it('blocks a malformed address', () => {
    expect(classify({ type: 'PAY', payee: { address: '0x1234' }, amount: '1' }, st, m, NOW).ruleId).toBe('INV-ADDRESS');
  });

  it('blocks paying the treasury itself, in any casing', () => {
    const v = classify({ type: 'PAY', payee: { address: TREASURY.toUpperCase().replace('0X', '0x') }, amount: '1' }, st, m, NOW);
    expect(v.ruleId).toBe('INV-ADDRESS');
  });

  it('blocks a request with no destination at all', () => {
    expect(classify({ type: 'PAY', payee: {}, amount: '1' }, st, m, NOW).ruleId).toBe('INV-ADDRESS');
  });

  it('blocks an unknown payee id with no address', () => {
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_ghost' }, amount: '1' }, st, m, NOW);
    expect(v.ruleId).toBe('INV-ADDRESS');
  });

  it('treats an unknown payee id with an address as a new payee', () => {
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_ghost', address: NEW_PAYEE }, amount: '1' }, st, m, NOW);
    expect(v.lane).toBe('ADDS_RISK');
    expect(failed(v)).toEqual(['payee_known']);
    expect(v.payee).toEqual({ payeeId: null, name: null, address: NEW_PAYEE.toLowerCase(), network: 'ARC-TESTNET' });
  });

  it('blocks another network', () => {
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_oceanic' }, amount: '1', network: 'BASE-SEPOLIA' }, st, m, NOW);
    expect(v.ruleId).toBe('INV-NETWORK');
  });

  it('blocks when the mandate itself names a network this build does not support', () => {
    expect(SUPPORTED_NETWORKS).toEqual(['ARC-TESTNET', 'ARC']);
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_oceanic' }, amount: '1', network: 'BASE' }, st, baseMandate({ network: 'BASE' }), NOW);
    expect(v.ruleId).toBe('INV-NETWORK');
  });

  it('blocks a known payee id sent to a different address', () => {
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_oceanic', address: HARBOR }, amount: '1' }, st, m, NOW);
    expect(v.ruleId).toBe('INV-PAYEE-PINNED');
    expect(v.lane).toBe('BREAKS_RULE');
  });

  it('matches a payee name case-insensitively, but only to block', () => {
    const v = classify({ type: 'PAY', payee: { name: '  oceanic FREIGHT ', address: NEW_PAYEE }, amount: '1' }, st, m, NOW);
    expect(v.ruleId).toBe('INV-PAYEE-PINNED');
  });

  it('resolves a known payee by its exact pinned address', () => {
    const v = classify({ type: 'PAY', payee: { address: OCEANIC.toLowerCase() }, amount: '1' }, st, m, NOW);
    expect(v.lane).toBe('INSIDE_MANDATE');
    expect(v.payee).toMatchObject({ payeeId: 'pay_oceanic', name: 'Oceanic Freight' });
  });

  it('accepts a known payee id with its own pinned address restated', () => {
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_oceanic', address: OCEANIC }, amount: '1' }, st, m, NOW);
    expect(v.ruleId).toBe('R-WM-PAY');
  });

  it('a matching name at the pinned address resolves to that payee', () => {
    const v = classify({ type: 'PAY', payee: { name: 'Harbor Cloud', address: HARBOR }, amount: '1' }, st, m, NOW);
    expect(v.payee?.payeeId).toBe('pay_harbor');
  });
});

describe('PAY: limits and windows', () => {
  it('waits for a person before the mandate starts', () => {
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_oceanic' }, amount: '1' }, st, baseMandate({ valid_from: '2026-10-28T00:00:00Z' }), NOW);
    expect(failed(v)).toEqual(['mandate_active']);
  });

  it('an override above the mandate cap never loosens it', () => {
    const loose = baseMandate({ payees: [payee('pay_oceanic', 'Oceanic Freight', OCEANIC, '900.000000')] });
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_oceanic' }, amount: '60' }, st, loose, NOW);
    expect(failed(v)).toEqual(['per_tx_limit']);
  });

  it('the fee counts toward funds', () => {
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_oceanic' }, amount: '25' }, baseState({ balanceUsdc: '25.000000' }), m, NOW);
    expect(v.ruleId).toBe('INV-FUNDS');
  });

  it('blocks an amount that is not a decimal string', () => {
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_oceanic' }, amount: 25 as unknown as string }, st, m, NOW);
    expect(v.ruleId).toBe('INV-AMOUNT');
  });

  it('records the details of every check', () => {
    const v = classify({ type: 'PAY', payee: { payeeId: 'pay_oceanic' }, amount: '25' }, st, m, NOW);
    expect(v.checks.map((c) => c.id)).toEqual(['mandate_active', 'payee_known', 'per_tx_limit', 'daily_cap', 'reserve_after']);
    expect(v.checks.every((c) => c.detail.length > 0)).toBe(true);
  });
});

describe('CANCEL_PAYMENT', () => {
  it.each(['RECEIVED', 'QUEUED', 'AWAITING_APPROVAL'])('lowers risk from %s', (s) => {
    expect(classify({ type: 'CANCEL_PAYMENT', intentStatus: s }, st, null, NOW).lane).toBe('LOWERS_RISK');
  });

  it.each(['SUBMITTED', 'PAID', 'FAILED'])('cannot cancel once %s', (s) => {
    expect(classify({ type: 'CANCEL_PAYMENT', intentStatus: s }, st, m, NOW).ruleId).toBe('INV-PAYMENT-STATE');
  });
});

describe('UPDATE_MANDATE: tighten applies now, loosen needs a person', () => {
  const limits = m.limits;

  it('needs an active mandate to diff against', () => {
    expect(classify({ type: 'UPDATE_MANDATE', proposed: m }, st, null, NOW).ruleId).toBe('INV-NO-MANDATE');
  });

  it('blocks a malformed limit', () => {
    expect(update(baseMandate({ limits: { ...limits, daily: '1.1234567' } })).ruleId).toBe('INV-AMOUNT');
  });

  it('no change lowers risk', () => {
    expect(update(baseMandate()).ruleId).toBe('R-LR-001');
  });

  it.each([
    ['daily lowered', { limits: { ...limits, daily: '100.000000' } }, 'LOWERS_RISK'],
    ['hard max raised', { limits: { ...limits, hard_max_per_tx: '2000.000000' } }, 'ADDS_RISK'],
    ['reserve raised', { limits: { ...limits, min_balance_after: '10.000000' } }, 'LOWERS_RISK'],
    ['reserve lowered', { limits: { ...limits, min_balance_after: '1.000000' } }, 'ADDS_RISK'],
    ['payee removed', { payees: [payee('pay_oceanic', 'Oceanic Freight', OCEANIC)] }, 'LOWERS_RISK'],
    ['payee added', { payees: [...m.payees, payee('pay_new', 'New Co', NEW_PAYEE)] }, 'ADDS_RISK'],
    ['payee address changed', { payees: [payee('pay_oceanic', 'Oceanic Freight', NEW_PAYEE), m.payees[1]!] }, 'ADDS_RISK'],
    ['payee renamed', { payees: [payee('pay_oceanic', 'Oceanic Ltd', OCEANIC), m.payees[1]!] }, 'ADDS_RISK'],
    ['override added', { payees: [payee('pay_oceanic', 'Oceanic Freight', OCEANIC, '10.000000'), m.payees[1]!] }, 'LOWERS_RISK'],
    ['expiry shortened', { expires_at: '2026-11-01T00:00:00Z' }, 'LOWERS_RISK'],
    ['expiry extended', { expires_at: '2027-01-01T00:00:00Z' }, 'ADDS_RISK'],
    ['start moved earlier', { valid_from: '2026-10-01T00:00:00Z' }, 'ADDS_RISK'],
    ['start moved later', { valid_from: '2026-10-28T00:00:00Z' }, 'LOWERS_RISK'],
    ['approval window longer', { approval: { ttl_minutes: 60, telegram: true } }, 'ADDS_RISK'],
    ['approval window shorter', { approval: { ttl_minutes: 5, telegram: true } }, 'LOWERS_RISK'],
    ['telegram toggled', { approval: { ttl_minutes: 15, telegram: false } }, 'ADDS_RISK'],
    ['source wallet changed', { source_wallet: { circle_wallet_id: 'other', address: NEW_PAYEE } }, 'ADDS_RISK'],
    ['network changed', { network: 'ARC' }, 'ADDS_RISK'],
  ] as const)('%s -> %s', (_name, change, lane) => {
    expect(update(baseMandate(change as Partial<Mandate>)).lane).toBe(lane);
  });

  it('an override removed loosens', () => {
    const tight = baseMandate({ payees: [payee('pay_oceanic', 'Oceanic Freight', OCEANIC, '10.000000'), m.payees[1]!] });
    const v = classify({ type: 'UPDATE_MANDATE', proposed: baseMandate() }, st, tight, NOW);
    expect(v.lane).toBe('ADDS_RISK');
    expect(failed(v)).toEqual(['mandate.payees.pay_oceanic.per_tx_override']);
  });

  it('an override raised loosens, lowered tightens', () => {
    const at = (o: string) => baseMandate({ payees: [payee('pay_oceanic', 'Oceanic Freight', OCEANIC, o), m.payees[1]!] });
    expect(classify({ type: 'UPDATE_MANDATE', proposed: at('20.000000') }, st, at('10.000000'), NOW).lane).toBe('ADDS_RISK');
    expect(classify({ type: 'UPDATE_MANDATE', proposed: at('5.000000') }, st, at('10.000000'), NOW).lane).toBe('LOWERS_RISK');
  });
});

describe('helpers', () => {
  it('maps lanes to outcomes and ranks', () => {
    expect(outcomeOf('LOWERS_RISK')).toBe('executed');
    expect(laneRank('BREAKS_RULE')).toBeGreaterThan(laneRank('ADDS_RISK'));
    expect(ENGINE_VERSION).toBe('0.1.0');
  });
});
