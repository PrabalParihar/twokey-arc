// Signs and activates the demo mandate (scaled-down amounts, PRD Appendix A) with payees pinned to the
// Circle wallets circle-setup created, and issues the demo agent's key into .env.
// Usage: pnpm seed [--rotate-agent-key]
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { activateMandate, buildMandate, createAgent, getActiveMandate } from '@twokey-arc/core';
import { agents, createDb } from '@twokey-arc/db';
import { migrateDb } from '@twokey-arc/db/migrator';
import { arcNetwork } from '@twokey-arc/circle';
import { upsertEnv } from './lib/env-file';
import { readWallets } from './lib/wallets';

const ORG = process.env.TWOKEY_ORG_ID ?? 'org_twokey';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const w = readWallets();
if (!w) throw new Error('run pnpm circle:setup first (config/wallets.arc-testnet.json is missing)');
const net = arcNetwork();

const { db, pool } = createDb(url, 2);
await migrateDb(db);

const now = new Date();
const current = await getActiveMandate(db, ORG);
const doc = buildMandate(
  {
    network: net.circleBlockchain,
    chainId: net.chainId,
    usdcAddress: net.usdc,
    treasury: { walletId: w.treasury.id, address: w.treasury.address },
    timezone: process.env.ORG_TIMEZONE ?? 'Asia/Kolkata',
    // Scaled down 100x to save faucet funds: payments of 0.25 / 0.75 / 0.40 / 0.60 USDC.
    limits: { per_tx: '0.50', daily: '1.50', hard_max_per_tx: '10.00', min_balance_after: '0.10' },
    payees: [
      { payee_id: 'pay_oceanic', name: 'Oceanic Freight', address: w.payees.oceanic.address },
      { payee_id: 'pay_harbor', name: 'Harbor Cloud', address: w.payees.harbor.address },
      // Brightline Media is deliberately NOT in the mandate: paying it needs the second key.
    ],
    validFrom: new Date(now.getTime() - 60_000),
    expiresAt: new Date(now.getTime() + 30 * 24 * 3600_000),
    approval: { ttl_minutes: 15, telegram: !!process.env.TELEGRAM_BOT_TOKEN },
    signedBy: process.env.OWNER_NAME ?? 'Prabal',
  },
  (current?.version ?? 0) + 1,
  now,
);
await db.transaction((tx) => activateMandate(tx, ORG, doc, { type: 'user', id: doc.signed_by }, now));
console.log(`mandate v${doc.version} active · per payment ${doc.limits.per_tx} · daily ${doc.limits.daily} · hard max ${doc.limits.hard_max_per_tx}`);

let pepper = process.env.AGENT_KEY_PEPPER;
if (!pepper) {
  pepper = randomBytes(32).toString('base64url');
  upsertEnv('AGENT_KEY_PEPPER', pepper);
  console.log('AGENT_KEY_PEPPER generated into .env (copy it to the Railway web service)');
}
const [existing] = await db.select().from(agents).where(eq(agents.agentId, 'ap-agent'));
if (!existing || process.argv.includes('--rotate-agent-key')) {
  if (existing) await db.update(agents).set({ status: 'REVOKED', agentId: `ap-agent-revoked-${Date.now()}` }).where(eq(agents.id, existing.id));
  const { apiKey } = await createAgent(db, { orgId: ORG, agentId: 'ap-agent', name: 'Accounts payable agent', pepper });
  upsertEnv('TWOKEY_AGENT_KEY', apiKey);
  console.log('agent ap-agent: key written to .env as TWOKEY_AGENT_KEY');
} else {
  console.log('agent ap-agent already exists (use --rotate-agent-key for a new key)');
}
await pool.end();
