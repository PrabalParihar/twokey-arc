// Creates the public demo's own treasury (one more EOA in the same wallet set on ARC-TESTNET) and
// records it in config/wallets.arc-testnet.json as demoTreasury. Fund it at https://faucet.circle.com.
import { randomUUID } from 'node:crypto';
import { arcNetwork, circleClientFromEnv, getUsdcBalance } from '@twokey-arc/circle';
import { readWallets, writeWallets } from './lib/wallets';

const net = arcNetwork();
const circle = circleClientFromEnv();
const w = readWallets();
if (!w) throw new Error('run pnpm circle:setup first');
if (!w.demoTreasury) {
  const res = await circle.createWallets({ walletSetId: w.walletSetId, blockchains: ['ARC-TESTNET'], accountType: 'EOA', count: 1, idempotencyKey: randomUUID() });
  const d = res.data!.wallets[0]!;
  w.demoTreasury = { id: d.id, address: d.address };
  writeWallets(w);
  console.log('created demo treasury');
}
console.log(`demo treasury ${w.demoTreasury.address} · USDC ${await getUsdcBalance(circle, w.demoTreasury.id, net.usdc)}`);
