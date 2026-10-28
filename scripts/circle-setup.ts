// Day 1: one wallet set and four EOA developer-controlled wallets on Arc (treasury + three demo payees).
// Testnet: needs CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET and asks the faucet for USDC.
// Mainnet (TWOKEY_NETWORK=mainnet + TWOKEY_ALLOW_MAINNET): needs CIRCLE_LIVE_API_KEY + CIRCLE_LIVE_ENTITY_SECRET,
// writes config/wallets.arc-mainnet.json, and the owner funds the treasury with real USDC himself.
// Prabal registers each entity secret himself. Safe to re-run: it reuses the wallets file.
import { randomUUID } from 'node:crypto';
import { arcNetwork, circleClientFromEnv, getUsdcBalance } from '@twokey-arc/circle';
import { upsertEnv } from './lib/env-file';
import { readWallets, WALLETS_PATH, writeWallets, type WalletsFile } from './lib/wallets';

const net = arcNetwork();
const mainnet = net.circleBlockchain === 'ARC';
const circle = circleClientFromEnv();

let w = readWallets();
if (!w) {
  // A wallet set groups wallets under the entity secret; on EVM chains its wallets share key material.
  const set = await circle.createWalletSet({
    name: mainnet ? 'twokey-arc-mainnet' : 'twokey-arc-demo',
    idempotencyKey: randomUUID(),
  });
  const walletSetId = set.data!.walletSet.id;

  // EOA: no creation fee, broadest support. On Arc, USDC is the gas token, so funding with USDC covers gas.
  const created = await circle.createWallets({
    walletSetId,
    blockchains: [net.circleBlockchain],
    accountType: 'EOA',
    count: 4,
    idempotencyKey: randomUUID(),
  });
  const [treasury, oceanic, harbor, brightline] = created.data!.wallets.map((x) => ({ id: x.id, address: x.address }));
  w = {
    network: net.circleBlockchain,
    walletSetId,
    createdAt: new Date().toISOString(),
    treasury: treasury!,
    payees: { oceanic: oceanic!, harbor: harbor!, brightline: brightline! },
  } satisfies WalletsFile;
  writeWallets(w);
  console.log(`created wallet set ${walletSetId} and 4 wallets -> ${WALLETS_PATH}`);

  if (mainnet) {
    console.log(`mainnet: send real USDC on Arc to the treasury yourself: ${w.treasury.address}`);
  } else {
    // Testnet USDC for the treasury through Circle's faucet API.
    try {
      await circle.requestTestnetTokens({
        address: w.treasury.address,
        blockchain: 'ARC-TESTNET',
        usdc: true,
      });
      console.log('requested testnet USDC for the treasury');
    } catch (err) {
      console.log(`faucet API refused (${(err as Error).message}); fund ${w.treasury.address} at https://faucet.circle.com (Arc Testnet)`);
    }
  }
} else {
  console.log(`reusing ${WALLETS_PATH}`);
}

// .env describes the local testnet setup; the mainnet ids live in config/wallets.arc-mainnet.json only.
if (!mainnet) {
  upsertEnv('CIRCLE_WALLET_SET_ID', w.walletSetId);
  upsertEnv('TREASURY_WALLET_ID', w.treasury.id);
  upsertEnv('TREASURY_WALLET_ADDRESS', w.treasury.address);
}

console.log(`treasury   ${w.treasury.address}  ${net.explorerUrl}/address/${w.treasury.address}`);
for (const [name, p] of Object.entries(w.payees)) console.log(`${name.padEnd(10)} ${p.address}`);
console.log(`treasury balance: USDC ${await getUsdcBalance(circle, w.treasury.id, net.usdc)} (faucet funds can take a minute)`);
