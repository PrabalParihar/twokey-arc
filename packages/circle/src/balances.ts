import type { CircleClient } from './client';
import { decimalToUsdc6 } from './units';

interface TokenBalance {
  amount: string;
  token: { tokenAddress?: string; symbol?: string; isNative: boolean };
}

/**
 * One USDC balance for a wallet on Arc. Balances come only from getWalletTokenBalance (getWallet carries
 * none). Arc exposes USDC twice, the 6-dp ERC-20 and the 18-dp native view of the same funds, so we take
 * ONE entry: the ERC-20 at 0x3600…0000 if listed, else the native USDC entry. Never both, never summed.
 */
export function pickUsdcBalance(balances: TokenBalance[], usdcAddress: string): string {
  const erc20 = balances.find((b) => b.token.tokenAddress?.toLowerCase() === usdcAddress.toLowerCase());
  const native = balances.find((b) => b.token.isNative && b.token.symbol?.toUpperCase().startsWith('USDC'));
  const entry = erc20 ?? native;
  return entry ? decimalToUsdc6(entry.amount, 'down') : '0.000000';
}

export async function getUsdcBalance(client: CircleClient, walletId: string, usdcAddress: string): Promise<string> {
  const res = await client.getWalletTokenBalance({ id: walletId });
  return pickUsdcBalance(res.data?.tokenBalances ?? [], usdcAddress);
}
