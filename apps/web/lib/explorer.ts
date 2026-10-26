/** Arc Testnet explorer links (chain 5042002). */
export const ARC_EXPLORER = process.env.ARC_EXPLORER_URL ?? 'https://explorer.testnet.arc.io';
export const explorerTx = (txHash: string) => `${ARC_EXPLORER}/tx/${txHash}`;
export const explorerAddress = (address: string) => `${ARC_EXPLORER}/address/${address}`;
