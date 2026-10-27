// Chaos suite against Arc Testnet with real Circle calls and tiny amounts (PRD §10, §23 #7).
// Runs in-process under its own org (org_chaos) so the deployed executor never touches these intents.
//   a) the same request 5x in parallel, then execute raced twice
//   b) "killed" after the attempt commit, before the Circle call (recovered by sweep + reconcile)
//   c) "killed" after the Circle call, before its id was stored (Circle has it; reconcile must find it)
//   d) the Circle call times out before reaching Circle (reconcile resubmits with the SAME key)
// Each payment must end PAID with exactly one Circle transaction for its refId.
// Usage: pnpm chaos [--runs 20] [--amount 0.01]
import { randomUUID } from 'node:crypto';
import { arcNetwork, circleClientFromEnv } from '@twokey-arc/circle';
import {
  activateMandate,
  buildMandate,
  CircleCallError,
  executePayment,
  getActiveMandate,
  pollAttempt,
  prepareExecution,
  reconcileAttempt,
  refreshBalance,
  requestPayment,
  sweep,
  type CirclePort,
  type ExecutorDeps,
  type JobName,
  type Jobs,
} from '@twokey-arc/core';
import { createDb, paymentIntents } from '@twokey-arc/db';
import { migrateDb } from '@twokey-arc/db/migrator';
import { eq } from 'drizzle-orm';
import { circlePort } from '../apps/executor/src/circle-port';
import { readWallets } from './lib/wallets';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const RUNS = Number(arg('runs', '5'));
const AMOUNT = arg('amount', '0.01');
const ORG = 'org_chaos';

const net = arcNetwork();
const w = readWallets();
if (!w) throw new Error('run pnpm circle:setup first');
const { db, pool } = createDb(process.env.DATABASE_URL!, 10);
await migrateDb(db);

const real = circlePort(circleClientFromEnv(), net);
type Fault = 'none' | 'after_call' | 'before_call';
let fault: Fault = 'none';
const circle: CirclePort = {
  ...real,
  async createTransfer(i) {
    if (fault === 'before_call') throw new CircleCallError('ambiguous', 'timeout', 'injected timeout before reaching Circle');
    const r = await real.createTransfer(i);
    if (fault === 'after_call') throw new CircleCallError('ambiguous', 'crash', 'injected crash after Circle accepted it');
    return r;
  },
};

const queue: { name: JobName; data: Record<string, string> }[] = [];
const jobs: Jobs = { send: async (name, data) => void queue.push({ name, data }) };
let skew = 0;
const deps: ExecutorDeps = {
  db,
  jobs,
  circle,
  now: () => new Date(Date.now() + skew),
  cfg: {
    orgId: ORG,
    network: net.circleBlockchain,
    chainId: net.chainId,
    usdcAddress: net.usdc,
    explorerUrl: net.explorerUrl,
    defaultFeeEstimateUsdc: '0.010000',
    approvalGraceSeconds: 0,
    demoMode: false,
  },
  // Resubmit at once in the suite: Circle's idempotency key is what must prevent a second transfer.
  reconcile: { resubmitAfterMs: 0, maxTries: 5, retryDelaySeconds: 1 },
};

if (!(await getActiveMandate(db, ORG))) {
  const now = new Date();
  await db.transaction((tx) =>
    activateMandate(
      tx,
      ORG,
      buildMandate(
        {
          network: net.circleBlockchain,
          chainId: net.chainId,
          usdcAddress: net.usdc,
          treasury: { walletId: w.treasury.id, address: w.treasury.address },
          timezone: 'Asia/Kolkata',
          limits: { per_tx: '0.10', daily: '10.00', hard_max_per_tx: '1.00', min_balance_after: '0.10' },
          payees: [{ payee_id: 'pay_oceanic', name: 'Oceanic Freight', address: w.payees.oceanic.address }],
          validFrom: new Date(now.getTime() - 60_000),
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          approval: { ttl_minutes: 15, telegram: false },
          signedBy: 'chaos-suite',
        },
        1,
        now,
      ),
      { type: 'system', id: 'chaos-suite' },
      now,
    ),
  );
}
await refreshBalance(deps, 'boot');

/** Runs queued jobs until none are left (polls wait a second between reads). */
async function drain(deadlineMs = 180_000) {
  const end = Date.now() + deadlineMs;
  while (queue.length && Date.now() < end) {
    const job = queue.shift()!;
    if (job.name === 'payment.execute') await executePayment(deps, job.data.intentId!);
    else if (job.name === 'attempt.reconcile') {
      await new Promise((r) => setTimeout(r, 1500));
      await reconcileAttempt(deps, job.data.attemptId!);
    } else if (job.name === 'attempt.poll') {
      await new Promise((r) => setTimeout(r, 1000));
      if ((await pollAttempt(deps, job.data.attemptId!)) !== null) queue.push(job);
    }
  }
}

const request = (idem: string) =>
  requestPayment(deps, { agentId: 'chaos-agent', idempotencyKey: idem, body: { payee: { payeeId: 'pay_oceanic' }, amount: AMOUNT, memo: idem.slice(0, 40) } });

async function verify(intentId: string, label: string) {
  const [i] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId));
  const since = new Date(i!.createdAt.getTime() - 120_000);
  let txs = await real.listTransactions({ walletId: w!.treasury.id, destinationAddress: w!.payees.oceanic.address, from: since, amount: AMOUNT });
  txs = txs.filter((t) => t.refId === intentId);
  const ok = i!.status === 'PAID' && txs.length === 1;
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(12)} ${intentId} · ${i!.status} · Circle transfers for refId: ${txs.length}${txs[0]?.txHash ? ` · ${txs[0].txHash}` : ''}`);
  return { ok, doubles: Math.max(0, txs.length - 1), txHash: txs[0]?.txHash };
}

const tally = { runs: 0, ok: 0, doubles: 0 };
const hashes: string[] = [];
const record = (r: { ok: boolean; doubles: number; txHash?: string | undefined }) => {
  tally.runs++;
  tally.ok += r.ok ? 1 : 0;
  tally.doubles += r.doubles;
  if (r.txHash) hashes.push(r.txHash);
};

for (let n = 0; n < RUNS; n++) {
  // a) same key 5x in parallel, then the execute job raced twice
  fault = 'none';
  const idem = `chaos-a-${randomUUID()}`;
  const five = await Promise.all(Array.from({ length: 5 }, () => request(idem)));
  const id = five[0]!.response.paymentId;
  if (new Set(five.map((f) => f.response.paymentId)).size !== 1) throw new Error('parallel requests created two intents');
  queue.length = 0;
  await Promise.all([executePayment(deps, id), executePayment(deps, id)]);
  await drain();
  record(await verify(id, 'a parallel'));

  // b) killed after the attempt commit, before the Circle call
  const b = (await request(`chaos-b-${randomUUID()}`)).response.paymentId;
  queue.length = 0;
  await prepareExecution(deps, b);
  skew = 20_000; // the restarted executor's sweeper sees a stale PENDING_SUBMIT attempt
  await sweep(deps);
  skew = 0;
  await drain();
  record(await verify(b, 'b kill-pre'));

  // c) killed after Circle accepted it, before the id was stored
  fault = 'after_call';
  const c = (await request(`chaos-c-${randomUUID()}`)).response.paymentId;
  queue.length = 0;
  await executePayment(deps, c);
  fault = 'none';
  await drain();
  record(await verify(c, 'c kill-post'));

  // d) the call times out before reaching Circle
  fault = 'before_call';
  const d = (await request(`chaos-d-${randomUUID()}`)).response.paymentId;
  queue.length = 0;
  await executePayment(deps, d);
  fault = 'none';
  await drain();
  record(await verify(d, 'd timeout'));
}

console.log(`\n${tally.ok}/${tally.runs} paid exactly once · double payments: ${tally.doubles}`);
await pool.end();
process.exit(tally.ok === tally.runs && tally.doubles === 0 ? 0 : 1);
