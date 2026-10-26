import { payeeFingerprint } from '@twokey-arc/seal';
import type { Mandate, MandatePayee, PolicyState } from '../src';

export const NOW = new Date('2026-10-27T06:30:00Z');
export const TREASURY = '0x7777777777777777777777777777777777777777';
export const OCEANIC = '0xA0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0A0';
export const HARBOR = '0xB0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0';
export const NEW_PAYEE = '0xC0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0';
export const ATTACKER = '0xD0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0';
export const ZERO = '0x0000000000000000000000000000000000000000';

export const payee = (payee_id: string, name: string, address: string, per_tx_override: string | null = null): MandatePayee => ({
  payee_id,
  name,
  network: 'ARC-TESTNET',
  address,
  fingerprint: payeeFingerprint('ARC-TESTNET', address),
  per_tx_override,
});

/** The PRD §8.4 baseline: per_tx 50, daily 150, hard_max 1000, reserve 5, Oceanic + Harbor. */
export function baseMandate(over: Partial<Mandate> = {}): Mandate {
  return {
    v: 1,
    mandate_id: 'mdt_test',
    version: 1,
    network: 'ARC-TESTNET',
    chain_id: 5042002,
    token: { symbol: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6 },
    source_wallet: { circle_wallet_id: 'wallet-treasury', address: TREASURY },
    timezone: 'Asia/Kolkata',
    limits: { per_tx: '50.000000', daily: '150.000000', hard_max_per_tx: '1000.000000', min_balance_after: '5.000000' },
    payees: [payee('pay_oceanic', 'Oceanic Freight', OCEANIC), payee('pay_harbor', 'Harbor Cloud', HARBOR)],
    valid_from: '2026-10-27T00:00:00Z',
    expires_at: '2026-11-26T18:30:00Z',
    approval: { ttl_minutes: 15, telegram: true },
    signed_by: 'owner',
    signed_at: '2026-10-26T12:00:00Z',
    signature: 'sha256:test',
    ...over,
  };
}

export const baseState = (over: Partial<PolicyState> = {}): PolicyState => ({
  balanceUsdc: '200.000000',
  feeEstimateUsdc: '0.010000',
  autoSpentTodayUsdc: '0.000000',
  liveAttemptForIntent: false,
  ...over,
});
