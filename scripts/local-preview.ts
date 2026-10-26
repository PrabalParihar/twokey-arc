// LOCAL UI PREVIEW ONLY. Fills a separate database with the demo story using a simulated Circle, so the
// dashboard can be looked at before Circle keys exist. Nothing here touches Arc; the "tx hashes" are
// placeholders (0x5151…) and must never be shown as evidence. Usage: DATABASE_URL=… pnpm tsx scripts/local-preview.ts
import { randomBytes } from 'node:crypto';
import { formatUsdc6, parseUsdc } from '@twokey-arc/money';
import {
  activateMandate,
  buildMandate,
  createAgent,
  decideApproval,
  driftDemo,
  executePayment,
  getApproval,
  pollAttempt,
  refreshBalance,
  requestPayment,
  type CirclePort,
  type CircleTx,
  type ExecutorDeps,
  type JobName,
} from '@twokey-arc/core';
import { createDb } from '@twokey-arc/db';
import { migrateDb } from '@twokey-arc/db/migrator';

const url = process.env.DATABASE_URL!;
if (!url.includes('preview')) throw new Error('refusing: the preview must use a database whose name contains "preview"');
const { db, pool } = createDb(url, 4);
await migrateDb(db);

const addr = () => `0x${randomBytes(20).toString('hex')}`;
const T = { treasury: addr(), oceanic: addr(), harbor: addr(), brightline: addr() };
let balance = parseUsdc('20.000000');
const txs = new Map<string, CircleTx & { amount: string }>();
const sim: CirclePort = {
  getUsdcBalance: async () => formatUsdc6(balance),
  estimateTransferFee: async () => '0.002100',
  async createTransfer(i) {
    const id = `sim-${randomBytes(4).toString('hex')}`;
    txs.set(id, { id, state: 'INITIATED', refId: i.refId, amount: i.amount, destinationAddress: i.destinationAddress });
    return { id, state: 'INITIATED' };
  },
  async getTransaction(id) {
    const t = txs.get(id)!;
    t.state = 'COMPLETE';
    t.txHash = `0x${'51'.repeat(32)}`;
    t.feeUsdc = '0.002100';
    balance -= parseUsdc(t.amount) + parseUsdc('0.002100');
    return { ...t };
  },
  listTransactions: async () => [],
};
const queue: { name: JobName; data: Record<string, string> }[] = [];
const deps: ExecutorDeps = {
  db,
  circle: sim,
  jobs: { send: async (name, data) => void queue.push({ name, data }) },
  cfg: {
    orgId: 'org_twokey',
    network: 'ARC-TESTNET',
    chainId: 5042002,
    usdcAddress: '0x3600000000000000000000000000000000000000',
    explorerUrl: 'https://explorer.testnet.arc.io',
    defaultFeeEstimateUsdc: '0.010000',
    approvalGraceSeconds: 0,
    demoMode: true,
  },
};
const drain = async () => {
  while (queue.length) {
    const j = queue.shift()!;
    if (j.name === 'payment.execute') await executePayment(deps, j.data.intentId!);
    if (j.name === 'attempt.poll') await pollAttempt(deps, j.data.attemptId!);
  }
};

const now = new Date();
await db.transaction((tx) =>
  activateMandate(
    tx,
    'org_twokey',
    buildMandate(
      {
        network: 'ARC-TESTNET',
        chainId: 5042002,
        usdcAddress: deps.cfg.usdcAddress,
        treasury: { walletId: 'sim-treasury', address: T.treasury },
        timezone: 'Asia/Kolkata',
        limits: { per_tx: '0.50', daily: '1.50', hard_max_per_tx: '10.00', min_balance_after: '0.10' },
        payees: [
          { payee_id: 'pay_oceanic', name: 'Oceanic Freight', address: T.oceanic },
          { payee_id: 'pay_harbor', name: 'Harbor Cloud', address: T.harbor },
        ],
        validFrom: new Date(now.getTime() - 60_000),
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        approval: { ttl_minutes: 15, telegram: true },
        signedBy: 'Prabal',
      },
      1,
      now,
    ),
    { type: 'user', id: 'Prabal' },
    now,
  ),
);
await refreshBalance(deps, 'boot');
await createAgent(db, { orgId: 'org_twokey', agentId: 'ap-agent', name: 'Accounts payable agent', pepper: 'preview' });
const pay = (key: string, payee: Record<string, string>, amount: string, memo: string) =>
  requestPayment(deps, { agentId: 'ap-agent', idempotencyKey: `invoice:${key}`, body: { payee, amount, memo } });
const sealOf = async (id: string) => (await getApproval(db, 'org_twokey', id))!.approval.seal;

await pay('INV-88213', { payeeId: 'pay_oceanic' }, '0.25', 'INV-88213');
await drain();
const bm = await pay('BM-7', { name: 'Brightline Media', address: T.brightline }, '0.75', 'BM-7');
await decideApproval(deps, { approvalId: bm.response.approval!.id, decision: 'approve', seal: await sealOf(bm.response.approval!.id), by: 'Prabal', via: 'dashboard' });
await drain();
await pay('INV-88240', { name: 'Oceanic Freight', address: '0xD15ea5E000000000000000000000000000000BAD' }, '0.40', 'INV-88240');
const hc = await pay('HC-2210', { payeeId: 'pay_harbor' }, '0.60', 'HC-2210');
await decideApproval(deps, { approvalId: hc.response.approval!.id, decision: 'approve', seal: await sealOf(hc.response.approval!.id), by: 'Prabal', via: 'dashboard' });
await driftDemo(deps, hc.response.paymentId);
await drain();
// One left waiting, so the approval card is live in the preview.
await pay('BM-8', { name: 'Brightline Media', address: T.brightline }, '0.75', 'BM-8');
console.log('preview data ready (simulated Circle)');
await pool.end();
