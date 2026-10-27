// LOCAL END-TO-END SIMULATION. Runs the real executor wiring (pg-boss jobs, sweeper, balance refresh)
// with a simulated CirclePort, so web + API + SDK + demo agent + MCP + UI can be tested over HTTP
// without Circle keys. Nothing touches Arc. Refuses any database whose name lacks "sim".
// Usage: DATABASE_URL=…/twokey_sim TWOKEY_WALLETS_FILE=… SIM_AGENT_KEY_FILE=… tsx scripts/local-sim.ts
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pino from 'pino';
import { formatUsdc6, parseUsdc } from '@twokey-arc/money';
import { activateMandate, buildMandate, createAgent, getActiveMandate, type CirclePort, type CircleTx } from '@twokey-arc/core';
import { agents, createDb } from '@twokey-arc/db';
import { migrateDb } from '@twokey-arc/db/migrator';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../apps/executor/src/config';
import { runExecutor } from '../apps/executor/src/run';
import { readWallets, writeWallets } from './lib/wallets';

const url = process.env.DATABASE_URL!;
if (!/sim/.test(new URL(url).pathname)) throw new Error('refusing: local-sim needs a database whose name contains "sim"');
if (!process.env.TWOKEY_WALLETS_FILE) throw new Error('set TWOKEY_WALLETS_FILE to a scratch path');
const addr = () => `0x${randomBytes(20).toString('hex')}`;

let w = readWallets();
if (!w) {
  w = {
    network: 'ARC-TESTNET',
    walletSetId: 'sim-set',
    createdAt: new Date().toISOString(),
    treasury: { id: 'sim-treasury', address: addr() },
    payees: { oceanic: { id: 'sim-1', address: addr() }, harbor: { id: 'sim-2', address: addr() }, brightline: { id: 'sim-3', address: addr() } },
  };
  writeWallets(w);
}

const { db, pool } = createDb(url, 2);
await migrateDb(db);
if (!(await getActiveMandate(db, 'org_twokey'))) {
  const now = new Date();
  await db.transaction((tx) =>
    activateMandate(
      tx,
      'org_twokey',
      buildMandate(
        {
          network: 'ARC-TESTNET',
          chainId: 5042002,
          usdcAddress: '0x3600000000000000000000000000000000000000',
          treasury: { walletId: w!.treasury.id, address: w!.treasury.address },
          timezone: 'Asia/Kolkata',
          limits: { per_tx: '0.50', daily: '1.50', hard_max_per_tx: '10.00', min_balance_after: '0.10' },
          payees: [
            { payee_id: 'pay_oceanic', name: 'Oceanic Freight', address: w!.payees.oceanic.address },
            { payee_id: 'pay_harbor', name: 'Harbor Cloud', address: w!.payees.harbor.address },
          ],
          validFrom: new Date(now.getTime() - 60_000),
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          approval: { ttl_minutes: 15, telegram: false },
          signedBy: 'Prabal',
        },
        1,
        now,
      ),
      { type: 'user', id: 'Prabal' },
      now,
    ),
  );
}
const [existing] = await db.select().from(agents).where(eq(agents.agentId, 'ap-agent'));
if (!existing) {
  const { apiKey } = await createAgent(db, { orgId: 'org_twokey', agentId: 'ap-agent', name: 'Accounts payable agent', pepper: process.env.AGENT_KEY_PEPPER! });
  writeFileSync(process.env.SIM_AGENT_KEY_FILE!, apiKey, { mode: 0o600 });
}
await pool.end();

// Simulated Circle: idempotent by key, COMPLETE on the second read, USDC fee taken from the balance.
let balance = parseUsdc('20.000000');
const FEE = '0.002100';
const txs = new Map<string, CircleTx & { amount: string; reads: number }>();
const byKey = new Map<string, string>();
const sim: CirclePort = {
  getUsdcBalance: async () => formatUsdc6(balance),
  estimateTransferFee: async () => FEE,
  async createTransfer(i) {
    let id = byKey.get(i.idempotencyKey);
    if (!id) {
      id = `sim-${randomBytes(6).toString('hex')}`;
      byKey.set(i.idempotencyKey, id);
      txs.set(id, { id, state: 'INITIATED', refId: i.refId, amount: i.amount, amounts: [i.amount], destinationAddress: i.destinationAddress, reads: 0 });
    }
    return { id, state: txs.get(id)!.state };
  },
  async getTransaction(id) {
    const t = txs.get(id)!;
    t.reads++;
    if (t.state !== 'COMPLETE' && t.reads >= 2) {
      t.state = 'COMPLETE';
      t.txHash = `0x${randomBytes(32).toString('hex')}`;
      t.feeUsdc = FEE;
      balance -= parseUsdc(t.amount) + parseUsdc(FEE);
    } else if (t.state === 'INITIATED') t.state = 'SENT';
    return { ...t };
  },
  listTransactions: async (i) => [...txs.values()].filter((t) => t.destinationAddress?.toLowerCase() === i.destinationAddress.toLowerCase()),
};

const log = pino({ name: 'twokey-executor-SIM' });
log.warn('SIMULATED Circle: no Arc transactions; tx hashes are random');
await runExecutor(loadConfig(), sim, log);
