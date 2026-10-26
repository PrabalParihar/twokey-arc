// Day 1 exit check: one raw 0.10 USDC transfer treasury -> Oceanic through Circle Wallets on Arc Testnet,
// polled to a terminal state. Bypasses the guard on purpose; it proves the rail, not the policy.
import { randomUUID } from 'node:crypto';
import { arcNetwork, circleClientFromEnv, createUsdcTransfer, getTransfer, getUsdcBalance } from '@twokey-arc/circle';
import { readWallets } from './lib/wallets';

const net = arcNetwork();
const circle = circleClientFromEnv();
const w = readWallets();
if (!w) throw new Error('run pnpm circle:setup first');

const before = await getUsdcBalance(circle, w.treasury.id, net.usdc);
const t0 = Date.now();
const { id } = await createUsdcTransfer(circle, {
  walletId: w.treasury.id,
  tokenAddress: net.usdc,
  destinationAddress: w.payees.oceanic.address,
  amount: '0.100000',
  idempotencyKey: randomUUID(),
  refId: `smoke-${Date.now()}`,
});
console.log(`circle transaction ${id}`);
for (;;) {
  const t = await getTransfer(circle, id);
  if (['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED'].includes(t.state)) {
    console.log(`${t.state} in ${((Date.now() - t0) / 1000).toFixed(1)} s · fee ${t.feeUsdc ?? 'n/a'} USDC`);
    if (t.txHash) console.log(`tx ${t.txHash}\n${net.explorerUrl}/tx/${t.txHash}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`balance ${before} -> ${await getUsdcBalance(circle, w.treasury.id, net.usdc)}`);
