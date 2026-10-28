import { displayUsdc, isUsdcString, parseUsdc } from '@twokey-arc/money';
import { payeeFingerprint } from '@twokey-arc/seal';
import type {
  Action,
  CancelPaymentAction,
  Check,
  Lane,
  Mandate,
  MandatePayee,
  Outcome,
  PayAction,
  PolicyState,
  ResolvedPayee,
  UpdateMandateAction,
  Verdict,
} from './types';

export const ENGINE_VERSION = '0.1.0';

/** Networks this build can pay on. Arc mainnet ("ARC") joins this list in M1, not before. */
export const SUPPORTED_NETWORKS: readonly string[] = ['ARC-TESTNET', 'ARC'];

const LANE_OUTCOME: Record<Lane, Outcome> = {
  LOWERS_RISK: 'executed',
  INSIDE_MANDATE: 'executed',
  ADDS_RISK: 'pending_approval',
  BREAKS_RULE: 'blocked',
};
const LANE_RANK: Record<Lane, number> = { LOWERS_RISK: 0, INSIDE_MANDATE: 1, ADDS_RISK: 2, BREAKS_RULE: 3 };

export const outcomeOf = (lane: Lane): Outcome => LANE_OUTCOME[lane];
/** Higher is stricter. */
export const laneRank = (lane: Lane): number => LANE_RANK[lane];

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const CANCELLABLE = new Set(['RECEIVED', 'QUEUED', 'AWAITING_APPROVAL']);

const verdict = (lane: Lane, ruleId: string, checks: Check[], payee?: ResolvedPayee): Verdict => ({
  lane,
  outcome: LANE_OUTCOME[lane],
  ruleId,
  checks,
  ...(payee ? { payee } : {}),
});

const blocked = (ruleId: string, detail: string, payee?: ResolvedPayee): Verdict =>
  verdict('BREAKS_RULE', ruleId, [{ id: ruleId, pass: false, detail }], payee);

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Pure and deterministic: no I/O, the clock is passed in. Invariants come first and can't be overridden;
 * then the lane checks decide between running on its own and waiting for a person.
 */
export function classify(action: Action, state: PolicyState, mandate: Mandate | null, now: Date): Verdict {
  switch (action.type) {
    case 'CANCEL_PAYMENT':
      return classifyCancel(action);
    case 'UPDATE_MANDATE':
      return classifyUpdate(action, mandate);
    case 'PAY':
      return classifyPay(action, state, mandate, now);
  }
}

function classifyCancel(a: CancelPaymentAction): Verdict {
  if (!CANCELLABLE.has(a.intentStatus)) {
    return blocked('INV-PAYMENT-STATE', `a payment that is ${a.intentStatus} can't be cancelled`);
  }
  return verdict('LOWERS_RISK', 'R-LR-001', [{ id: 'not_submitted', pass: true, detail: `still ${a.intentStatus}, nothing sent` }]);
}

function classifyPay(a: PayAction, state: PolicyState, mandate: Mandate | null, now: Date): Verdict {
  if (!mandate) return blocked('INV-NO-MANDATE', 'no active mandate');

  if (!isUsdcString(a.amount) || parseUsdc(a.amount) <= 0n) {
    return blocked('INV-AMOUNT', 'amount must be a positive USDC amount with at most 6 decimals');
  }
  const amount = parseUsdc(a.amount);

  // Resolve the destination. A name can only ever block (it pins), never resolve to an address.
  const byId = a.payee.payeeId ? mandate.payees.find((p) => p.payee_id === a.payee.payeeId) : undefined;
  const byName = !a.payee.payeeId && a.payee.name ? mandate.payees.find((p) => sameName(p.name, a.payee.name as string)) : undefined;
  const pinned = byId ?? byName;
  const address = a.payee.address ?? pinned?.address;
  if (!address) return blocked('INV-ADDRESS', 'no destination address');
  if (!EVM_ADDRESS.test(address)) return blocked('INV-ADDRESS', 'not a valid EVM address');
  const lower = address.toLowerCase();
  if (lower === ZERO_ADDRESS) return blocked('INV-ADDRESS', 'the zero address; Arc reverts it');
  if (lower === mandate.source_wallet.address.toLowerCase()) return blocked('INV-ADDRESS', 'the treasury itself');

  const network = a.network ?? mandate.network;
  if (network !== mandate.network || !SUPPORTED_NETWORKS.includes(network)) {
    return blocked('INV-NETWORK', `${network} is not supported here (only ${SUPPORTED_NETWORKS.join(', ')})`);
  }

  if (pinned && payeeFingerprint(network, lower) !== pinned.fingerprint) {
    return blocked('INV-PAYEE-PINNED', `${pinned.name} is pinned to another address; a changed address is never paid`, {
      payeeId: null,
      name: pinned.name,
      address: lower,
      network,
    });
  }

  const known: MandatePayee | undefined = pinned ?? mandate.payees.find((p) => p.address.toLowerCase() === lower);
  const payee: ResolvedPayee = {
    payeeId: known?.payee_id ?? null,
    name: known?.name ?? a.payee.name ?? null,
    address: lower,
    network,
  };

  const limits = mandate.limits;
  const hardMax = parseUsdc(limits.hard_max_per_tx);
  if (amount > hardMax) {
    return blocked('INV-HARD-MAX', `over the hard maximum of ${displayUsdc(hardMax)}; no approval can override it`, payee);
  }

  const balance = parseUsdc(state.balanceUsdc);
  const fee = parseUsdc(state.feeEstimateUsdc);
  if (amount + fee > balance) {
    return blocked('INV-FUNDS', `needs ${displayUsdc(amount + fee)} with gas, the wallet has ${displayUsdc(balance)}`, payee);
  }
  if (state.liveAttemptForIntent) return blocked('INV-DUPLICATE', 'a transfer for this payment is already in flight', payee);

  const perTxMandate = parseUsdc(limits.per_tx);
  const override = known?.per_tx_override ? parseUsdc(known.per_tx_override) : null;
  const perTx = override !== null && override < perTxMandate ? override : perTxMandate;
  const daily = parseUsdc(limits.daily);
  const spent = parseUsdc(state.autoSpentTodayUsdc);
  const after = balance - amount - fee;
  const reserve = parseUsdc(limits.min_balance_after);
  const t = now.getTime();
  const active = Date.parse(mandate.valid_from) <= t && t < Date.parse(mandate.expires_at);

  const checks: Check[] = [
    { id: 'mandate_active', pass: active, detail: active ? 'Mandate in force' : 'Mandate is not in force right now' },
    { id: 'payee_known', pass: known !== undefined, detail: known ? 'Known payee, pinned address' : 'New payee, not in your mandate' },
    {
      id: 'per_tx_limit',
      pass: amount <= perTx,
      detail: amount <= perTx ? `Within the ${displayUsdc(perTx)} per-payment cap` : `Over your ${displayUsdc(perTx)} per-payment cap`,
    },
    {
      id: 'daily_cap',
      pass: spent + amount <= daily,
      detail: `${displayUsdc(spent + amount)} of the ${displayUsdc(daily)} daily auto cap, with this one`,
    },
    {
      id: 'reserve_after',
      pass: after >= reserve,
      detail: `Leaves ${displayUsdc(after)}; reserve is ${displayUsdc(reserve)}`,
    },
  ];
  return checks.every((c) => c.pass)
    ? verdict('INSIDE_MANDATE', 'R-WM-PAY', checks, payee)
    : verdict('ADDS_RISK', 'R-EX-PAY', checks, payee);
}

type Direction = 'tighten' | 'loosen';
interface Change {
  field: string;
  direction: Direction;
}

/** Larger value is looser (caps, windows). */
const cmpLooser = (field: string, before: bigint, after: bigint): Change[] =>
  before === after ? [] : [{ field, direction: after > before ? 'loosen' : 'tighten' }];

/** Effective per-payee cap: no override means "no extra cap". */
const overrideCap = (p: MandatePayee): bigint | null => (p.per_tx_override ? parseUsdc(p.per_tx_override) : null);

function diffMandate(cur: Mandate, next: Mandate): Change[] {
  const changes: Change[] = [];
  for (const key of ['per_tx', 'daily', 'hard_max_per_tx'] as const) {
    changes.push(...cmpLooser(`limits.${key}`, parseUsdc(cur.limits[key]), parseUsdc(next.limits[key])));
  }
  // A larger reserve is tighter.
  changes.push(...cmpLooser('limits.min_balance_after', parseUsdc(next.limits.min_balance_after), parseUsdc(cur.limits.min_balance_after)));
  changes.push(...cmpLooser('expires_at', BigInt(Date.parse(cur.expires_at)), BigInt(Date.parse(next.expires_at))));
  changes.push(...cmpLooser('valid_from', BigInt(Date.parse(next.valid_from)), BigInt(Date.parse(cur.valid_from))));
  changes.push(...cmpLooser('approval.ttl_minutes', BigInt(cur.approval.ttl_minutes), BigInt(next.approval.ttl_minutes)));

  for (const p of cur.payees) {
    const q = next.payees.find((x) => x.payee_id === p.payee_id);
    if (!q) {
      changes.push({ field: `payees.${p.payee_id}`, direction: 'tighten' });
      continue;
    }
    if (q.address.toLowerCase() !== p.address.toLowerCase() || q.network !== p.network || q.fingerprint !== p.fingerprint || q.name !== p.name) {
      changes.push({ field: `payees.${p.payee_id}`, direction: 'loosen' });
    }
    const a = overrideCap(p);
    const b = overrideCap(q);
    if (a !== b) {
      const looser = b === null || (a !== null && b > a);
      changes.push({ field: `payees.${p.payee_id}.per_tx_override`, direction: looser ? 'loosen' : 'tighten' });
    }
  }
  for (const q of next.payees) {
    if (!cur.payees.some((p) => p.payee_id === q.payee_id)) changes.push({ field: `payees.${q.payee_id}`, direction: 'loosen' });
  }

  // Anything else that moved is treated as loosening: the safe default for fields with no obvious order.
  const other = (m: Mandate) =>
    JSON.stringify([m.network, m.chain_id, m.token, m.source_wallet, m.timezone, m.approval.telegram]);
  if (other(cur) !== other(next)) changes.push({ field: 'identity', direction: 'loosen' });
  return changes;
}

function classifyUpdate(a: UpdateMandateAction, mandate: Mandate | null): Verdict {
  if (!mandate) return blocked('INV-NO-MANDATE', 'no active mandate to change');
  const p = a.proposed;
  const amounts = [...Object.values(p.limits), ...p.payees.flatMap((x) => (x.per_tx_override ? [x.per_tx_override] : []))];
  if (!amounts.every(isUsdcString)) return blocked('INV-AMOUNT', 'every limit must be a USDC amount with at most 6 decimals');

  const changes = diffMandate(mandate, p);
  const checks: Check[] = changes.map((c) => ({
    id: `mandate.${c.field}`,
    pass: c.direction === 'tighten',
    detail: c.direction === 'tighten' ? 'tightens the mandate' : 'loosens the mandate',
  }));
  return changes.some((c) => c.direction === 'loosen')
    ? verdict('ADDS_RISK', 'R-EX-UPDATE_MANDATE', checks)
    : verdict('LOWERS_RISK', 'R-LR-001', checks);
}

