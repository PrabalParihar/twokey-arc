import { USDC_ARC_ADDRESS } from '@twokey-arc/money';

/** Arc Testnet, verified against docs.arc.io and the circlefin `use-arc` skill (Oct 26, 2026). */
export const ARC_TESTNET = {
  circleBlockchain: 'ARC-TESTNET',
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerUrl: 'https://explorer.testnet.arc.io',
  usdc: USDC_ARC_ADDRESS,
  cctpDomain: 26,
} as const;

export const ARC_MAINNET = {
  circleBlockchain: 'ARC',
  chainId: 5042,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorerUrl: 'https://explorer.arc.io',
  usdc: USDC_ARC_ADDRESS,
  cctpDomain: 26,
} as const;

export type ArcNetwork = typeof ARC_TESTNET | typeof ARC_MAINNET;

/**
 * Testnet unless a human set TWOKEY_NETWORK=mainnet, and mainnet also needs TWOKEY_ALLOW_MAINNET spelled out:
 * two deliberate settings before real USDC can move. Arc mainnet (chain 5042, Circle code ARC) checked live
 * against rpc.mainnet.arc.io and Circle's supported-blockchains page on Oct 28, 2026.
 */
export function arcNetwork(env: NodeJS.ProcessEnv = process.env): ArcNetwork {
  const want = env.TWOKEY_NETWORK ?? 'testnet';
  if (want === 'testnet') return ARC_TESTNET;
  if (want === 'mainnet') {
    if (env.TWOKEY_ALLOW_MAINNET !== 'i-understand-real-usdc') {
      throw new Error('mainnet needs TWOKEY_ALLOW_MAINNET=i-understand-real-usdc as well as TWOKEY_NETWORK=mainnet');
    }
    return ARC_MAINNET;
  }
  throw new Error(`TWOKEY_NETWORK must be testnet or mainnet, got ${want}`);
}

export const explorerTx = (net: ArcNetwork, txHash: string) => `${net.explorerUrl}/tx/${txHash}`;
export const explorerAddress = (net: ArcNetwork, address: string) => `${net.explorerUrl}/address/${address}`;
