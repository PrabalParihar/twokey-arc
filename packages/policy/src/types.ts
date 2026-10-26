export type Lane = 'LOWERS_RISK' | 'INSIDE_MANDATE' | 'ADDS_RISK' | 'BREAKS_RULE';
export type Outcome = 'executed' | 'pending_approval' | 'blocked';

export interface MandatePayee {
  payee_id: string;
  name: string;
  network: string;
  address: string;
  /** sha256(network + ":" + lowercase(address)), signed with the mandate. */
  fingerprint: string;
  /** Optional tighter per-payee cap. It can only lower the per-payment limit, never raise it. */
  per_tx_override: string | null;
}

export interface Mandate {
  v: 1;
  mandate_id: string;
  version: number;
  network: string;
  chain_id: number;
  token: { symbol: 'USDC'; address: string; decimals: 6 };
  source_wallet: { circle_wallet_id: string; address: string };
  timezone: string;
  limits: {
    per_tx: string;
    daily: string;
    hard_max_per_tx: string;
    min_balance_after: string;
  };
  payees: MandatePayee[];
  valid_from: string;
  expires_at: string;
  approval: { ttl_minutes: number; telegram: boolean };
  signed_by: string;
  signed_at: string;
  signature: string;
}

/** A fresh read built by the caller. The engine never fetches anything itself. */
export interface PolicyState {
  balanceUsdc: string;
  feeEstimateUsdc: string;
  /** Amounts paid or in flight today (mandate timezone) that ran without an approval. */
  autoSpentTodayUsdc: string;
  liveAttemptForIntent: boolean;
}

export interface PayAction {
  type: 'PAY';
  payee: { payeeId?: string; address?: string; name?: string };
  amount: string;
  network?: string;
  memo?: string;
}

export interface CancelPaymentAction {
  type: 'CANCEL_PAYMENT';
  intentStatus: string;
}

export interface UpdateMandateAction {
  type: 'UPDATE_MANDATE';
  proposed: Mandate;
}

export type Action = PayAction | CancelPaymentAction | UpdateMandateAction;

export interface Check {
  id: string;
  pass: boolean;
  detail: string;
}

/** Where a PAY resolved to. `payeeId` is set only when the destination is a pinned mandate payee. */
export interface ResolvedPayee {
  payeeId: string | null;
  name: string | null;
  address: string;
  network: string;
}

export interface Verdict {
  lane: Lane;
  outcome: Outcome;
  ruleId: string;
  checks: Check[];
  payee?: ResolvedPayee;
}
