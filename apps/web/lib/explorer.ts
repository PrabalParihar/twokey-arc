/** Arc explorer links. The owner's treasury follows TWOKEY_NETWORK; the public demo is always on testnet. */
export const TESTNET_EXPLORER = 'https://explorer.testnet.arc.io';
export const MAINNET_EXPLORER = 'https://explorer.arc.io';
export const ARC_EXPLORER = process.env.ARC_EXPLORER_URL ?? (process.env.TWOKEY_NETWORK === 'mainnet' ? MAINNET_EXPLORER : TESTNET_EXPLORER);
export const explorerTx = (txHash: string, base = ARC_EXPLORER) => `${base}/tx/${txHash}`;
export const explorerAddress = (address: string, base = ARC_EXPLORER) => `${base}/address/${address}`;
