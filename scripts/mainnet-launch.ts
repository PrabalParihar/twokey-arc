// Mainnet launch, the parts that need no human: check the LIVE keys are in .env (never printing them),
// create the mainnet wallets, then wait until the owner has funded the treasury. Moves no money itself.
// The LIVE key, the entity secret registration and the USDC stay with Prabal (see docs/RUNBOOK.md).
// Usage: pnpm mainnet:launch [min USDC, default 5]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.TWOKEY_NETWORK = 'mainnet';
process.env.TWOKEY_ALLOW_MAINNET = 'i-understand-real-usdc';
const { arcNetwork, circleClientFromEnv, getUsdcBalance } = await import('@twokey-arc/circle');

const missing = ['CIRCLE_LIVE_API_KEY', 'CIRCLE_LIVE_ENTITY_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing in .env: ${missing.join(', ')}. Create them in the Circle Console (Live mode) first.`);
  process.exit(1);
}
if (!process.env.CIRCLE_LIVE_API_KEY!.startsWith('LIVE_API_KEY:')) {
  console.error('CIRCLE_LIVE_API_KEY does not look like a LIVE key (it should start with LIVE_API_KEY:)');
  process.exit(1);
}

execFileSync('pnpm', ['circle:setup'], { stdio: 'inherit', env: process.env });

const net = arcNetwork();
const w = JSON.parse(readFileSync(resolve(import.meta.dirname, '../config/wallets.arc-mainnet.json'), 'utf8')) as { treasury: { id: string; address: string } };
const min = Number(process.argv[2] ?? 5);
const circle = circleClientFromEnv();
console.log(`\nwaiting for at least ${min} USDC on Arc mainnet at ${w.treasury.address}\n${net.explorerUrl}/address/${w.treasury.address}`);
for (let i = 0; i < 480; i++) {
  const bal = Number(await getUsdcBalance(circle, w.treasury.id, net.usdc));
  if (bal >= min) {
    console.log(`funded: ${bal} USDC. Ready to switch Railway to mainnet.`);
    process.exit(0);
  }
  if (i % 4 === 0) console.log(`balance ${bal} USDC, still waiting…`);
  await new Promise((r) => setTimeout(r, 15_000));
}
console.error('no funding after 2 hours; run again once the USDC has arrived');
process.exit(1);
