import { HttpRequestError, HttpResponseError } from '@circle-fin/developer-controlled-wallets';
import type { CircleClient } from './client';
import { decimalToUsdc6 } from './units';

export interface TransferRequest {
  walletId: string;
  tokenAddress: string;
  destinationAddress: string;
  /** 6-dp USDC string, e.g. "0.250000". */
  amount: string;
  /** UUID v4, committed in Twokey's attempts table BEFORE this call. Reused verbatim on every retry. */
  idempotencyKey: string;
  /** Twokey's payment intent id, so reconciliation can find the transfer at Circle. */
  refId: string;
}

/** Thrown with a verdict the executor can act on: `rejected` is safe to fail, `ambiguous` must reconcile. */
export class CircleError extends Error {
  constructor(
    readonly kind: 'ambiguous' | 'rejected',
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CircleError';
  }
}

export function classifyCircleError(err: unknown): CircleError {
  if (err instanceof HttpResponseError) {
    // 408/409/429 and 5xx may or may not have created the transfer; any other 4xx definitely did not.
    const ambiguous = err.status >= 500 || [408, 409, 429].includes(err.status);
    return new CircleError(ambiguous ? 'ambiguous' : 'rejected', String(err.status), err.message);
  }
  if (err instanceof HttpRequestError) return new CircleError('ambiguous', String(err.code), err.message);
  return new CircleError('ambiguous', 'unknown', err instanceof Error ? err.message : String(err));
}

/** USDC transfer on Arc through a Circle developer-controlled wallet. Gas is paid in USDC by the same wallet. */
export async function createUsdcTransfer(client: CircleClient, r: TransferRequest): Promise<{ id: string; state: string }> {
  try {
    const res = await client.createTransaction({
      walletId: r.walletId,
      tokenAddress: r.tokenAddress,
      destinationAddress: r.destinationAddress,
      amount: [r.amount],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: r.idempotencyKey,
      refId: r.refId,
    });
    if (!res.data?.id) throw new CircleError('ambiguous', 'empty_response', 'createTransaction returned no id');
    return { id: res.data.id, state: res.data.state };
  } catch (err) {
    throw err instanceof CircleError ? err : classifyCircleError(err);
  }
}

export interface TransferStatus {
  id: string;
  state: string;
  txHash?: string;
  feeUsdc?: string;
  errorReason?: string;
  refId?: string;
  amounts?: string[];
  destinationAddress?: string;
}

const toStatus = (t: {
  id: string;
  state: string;
  txHash?: string;
  networkFee?: string;
  errorReason?: string;
  refId?: string;
  amounts?: string[];
  destinationAddress?: string;
}): TransferStatus => ({
  id: t.id,
  state: t.state,
  ...(t.txHash ? { txHash: t.txHash } : {}),
  ...(t.networkFee ? { feeUsdc: decimalToUsdc6(t.networkFee, 'up') } : {}),
  ...(t.errorReason ? { errorReason: t.errorReason } : {}),
  ...(t.refId ? { refId: t.refId } : {}),
  ...(t.amounts ? { amounts: t.amounts } : {}),
  ...(t.destinationAddress ? { destinationAddress: t.destinationAddress } : {}),
});

/** One status read. Terminal states: COMPLETE, FAILED, DENIED, CANCELLED. */
export async function getTransfer(client: CircleClient, id: string): Promise<TransferStatus> {
  try {
    const res = await client.getTransaction({ id });
    const t = res.data?.transaction;
    if (!t) throw new CircleError('ambiguous', 'empty_response', `no transaction ${id}`);
    return toStatus(t);
  } catch (err) {
    throw err instanceof CircleError ? err : classifyCircleError(err);
  }
}

/** For reconciliation: our wallet's transfers to one address since `from`. */
export async function listTransfers(
  client: CircleClient,
  i: { walletId: string; destinationAddress: string; from: Date; blockchain: string },
): Promise<TransferStatus[]> {
  // Filter the destination locally, case-insensitively: addresses may come back checksummed.
  const res = await client.listTransactions({
    walletIds: [i.walletId],
    from: i.from.toISOString(),
    blockchain: i.blockchain as never,
    pageSize: 50,
  });
  const dest = i.destinationAddress.toLowerCase();
  return (res.data?.transactions ?? []).filter((t) => t.destinationAddress?.toLowerCase() === dest).map(toStatus);
}

/** Medium-level fee estimate for a USDC transfer, converted to the 6-dp view and rounded up. */
export async function estimateUsdcTransferFee(
  client: CircleClient,
  i: { walletId: string; tokenAddress: string; destinationAddress: string; amount: string },
): Promise<string | null> {
  const res = await client.estimateTransferFee({
    walletId: i.walletId,
    tokenAddress: i.tokenAddress,
    destinationAddress: i.destinationAddress,
    amount: [i.amount],
  });
  const fee = res.data?.medium?.networkFee;
  return fee ? decimalToUsdc6(fee, 'up') : null;
}
