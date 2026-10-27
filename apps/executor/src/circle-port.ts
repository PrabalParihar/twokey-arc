import {
  CircleError,
  createUsdcTransfer,
  estimateUsdcTransferFee,
  getTransfer,
  getUsdcBalance,
  listTransfers,
  type ArcNetwork,
  type CircleClient,
} from '@twokey-arc/circle';
import { CircleCallError, type CirclePort } from '@twokey-arc/core';

/** Twokey's CirclePort over Circle developer-controlled wallets. This process is the only one with the client. */
export function circlePort(client: CircleClient, net: ArcNetwork): CirclePort {
  const mapErr = (err: unknown): never => {
    if (err instanceof CircleError) throw new CircleCallError(err.kind, err.code, err.message);
    throw err;
  };
  return {
    getUsdcBalance: (walletId) => getUsdcBalance(client, walletId, net.usdc),
    estimateTransferFee: (i) => estimateUsdcTransferFee(client, { ...i, tokenAddress: net.usdc, blockchain: net.circleBlockchain }),
    createTransfer: (i) => createUsdcTransfer(client, { ...i, blockchain: net.circleBlockchain }).catch(mapErr),
    getTransaction: (id) => getTransfer(client, id).catch(mapErr),
    listTransactions: (i) => listTransfers(client, i),
  };
}
