import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createDb, type Db } from '@twokey-arc/db';
import { migrateDb } from '@twokey-arc/db/migrator';
import { formatUsdc6, parseUsdc, toUsdc6 } from '@twokey-arc/money';
import {
  activateMandate,
  buildMandate,
  CircleCallError,
  createAgent,
  executePayment,
  expireApprovals,
  pollAttempt,
  reconcileAttempt,
  refreshBalance,
  type CirclePort,
  type CircleTx,
  type CoreConfig,
  type ExecutorDeps,
  type JobName,
  type JobOptions,
  type Jobs,
} from '../src';

export const ORG = 'org_test';
export const TREASURY = '0x7777777777777777777777777777777777777777';
export const OCEANIC = '0xa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0';
export const HARBOR = '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
export const BRIGHTLINE = '0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0';
export const ATTACKER = '0xd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0';

export const cfg: CoreConfig = {
  orgId: ORG,
  network: 'ARC-TESTNET',
  chainId: 5042002,
  usdcAddress: '0x3600000000000000000000000000000000000000',
  explorerUrl: 'https://explorer.testnet.arc.io',
  defaultFeeEstimateUsdc: '0.010000',
  approvalGraceSeconds: 0,
  demoMode: true,
};

type Mode = 'ok' | 'reject' | 'timeout_before_create' | 'timeout_after_create';

/**
 * Stands in for Circle Wallets. Honors idempotency keys like the real API (same key, same transaction),
 * moves a transfer to `finalState` on its first poll, and counts every call.
 */
export class FakeCircle implements CirclePort {
  balance = 200_000_000n;
  fee = '0.010000';
  mode: Mode = 'ok';
  finalState: 'COMPLETE' | 'FAILED' | 'DENIED' = 'COMPLETE';
  calls = { createTransfer: 0, getTransaction: 0, listTransactions: 0, getUsdcBalance: 0 };
  onCreate?: (idempotencyKey: string) => Promise<void>;
  readonly txs = new Map<string, CircleTx & { idempotencyKey: string; amount: string }>();
  private byKey = new Map<string, string>();
  private seq = 0;

  async getUsdcBalance() {
    this.calls.getUsdcBalance++;
    return formatUsdc6(this.balance);
  }

  async estimateTransferFee() {
    return this.fee;
  }

  async createTransfer(i: Parameters<CirclePort['createTransfer']>[0]) {
    this.calls.createTransfer++;
    await this.onCreate?.(i.idempotencyKey);
    if (this.mode === 'reject') throw new CircleCallError('rejected', '400', 'invalid destination');
    if (this.mode === 'timeout_before_create') throw new CircleCallError('ambiguous', 'timeout', 'socket hang up');
    let id = this.byKey.get(i.idempotencyKey);
    if (!id) {
      id = `ctx_${++this.seq}`;
      this.byKey.set(i.idempotencyKey, id);
      this.txs.set(id, {
        id,
        state: 'INITIATED',
        refId: i.refId,
        amounts: [i.amount],
        destinationAddress: i.destinationAddress,
        idempotencyKey: i.idempotencyKey,
        amount: i.amount,
      });
    }
    if (this.mode === 'timeout_after_create') throw new CircleCallError('ambiguous', 'timeout', 'socket hang up');
    return { id, state: this.txs.get(id)!.state };
  }

  async getTransaction(id: string): Promise<CircleTx> {
    this.calls.getTransaction++;
    const t = this.txs.get(id)!;
    if (t.state === 'INITIATED') {
      t.state = this.finalState;
      if (t.state === 'COMPLETE') {
        t.txHash = `0x${randomBytes(32).toString('hex')}`;
        t.feeUsdc = this.fee;
        this.balance -= parseUsdc(t.amount) + parseUsdc(this.fee);
      } else {
        t.errorReason = 'INSUFFICIENT_NATIVE_TOKEN';
      }
    }
    return { ...t };
  }

  async listTransactions(i: { destinationAddress: string }) {
    this.calls.listTransactions++;
    return [...this.txs.values()].filter((t) => t.destinationAddress === i.destinationAddress);
  }

  transfersFor(refId: string) {
    return [...this.txs.values()].filter((t) => t.refId === refId);
  }
}

/** Records jobs; `drain` runs them inline, ignoring startAfter, until the queue is empty. */
export class MemoryJobs implements Jobs {
  queue: { name: JobName; data: Record<string, string>; opts?: JobOptions }[] = [];
  sent: JobName[] = [];
  async send(name: JobName, data: Record<string, string>, opts?: JobOptions) {
    this.queue.push({ name, data, ...(opts ? { opts } : {}) });
    this.sent.push(name);
  }
}

export class Clock {
  constructor(public t = new Date('2026-10-27T06:30:00.000Z')) {}
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export interface Harness {
  url: string;
  db: Db;
  pool: pg.Pool;
  circle: FakeCircle;
  jobs: MemoryJobs;
  clock: Clock;
  deps: ExecutorDeps;
  agentKey: string;
  drain(opts?: { skip?: JobName[] }): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const admin = inject('pgAdminUrl');
  const name = `twokey_t_${randomBytes(6).toString('hex')}`;
  const adminPool = new pg.Pool({ connectionString: admin, max: 1 });
  await adminPool.query(`create database ${name}`);
  await adminPool.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const { db, pool } = createDb(url.toString(), 20);
  await migrateDb(db);

  const circle = new FakeCircle();
  const jobs = new MemoryJobs();
  const clock = new Clock();
  const deps: ExecutorDeps = {
    db,
    cfg,
    jobs,
    circle,
    now: clock.now,
    reconcile: { resubmitAfterMs: 120_000, maxTries: 3, retryDelaySeconds: 20 },
  };

  await db.transaction((tx) =>
    activateMandate(
      tx,
      ORG,
      buildMandate(
        {
          network: 'ARC-TESTNET',
          chainId: 5042002,
          usdcAddress: cfg.usdcAddress,
          treasury: { walletId: 'wallet-treasury', address: TREASURY },
          timezone: 'Asia/Kolkata',
          limits: { per_tx: '50', daily: '150', hard_max_per_tx: '1000', min_balance_after: '5' },
          payees: [
            { payee_id: 'pay_oceanic', name: 'Oceanic Freight', address: OCEANIC },
            { payee_id: 'pay_harbor', name: 'Harbor Cloud', address: HARBOR },
          ],
          validFrom: new Date('2026-10-26T00:00:00Z'),
          expiresAt: new Date('2026-11-26T00:00:00Z'),
          approval: { ttl_minutes: 15, telegram: false },
          signedBy: 'owner',
        },
        1,
        clock.now(),
      ),
      { type: 'user', id: 'owner' },
      clock.now(),
    ),
  );
  await refreshBalance(deps, 'boot');
  const { apiKey } = await createAgent(db, { orgId: ORG, agentId: 'ap-agent', name: 'Accounts payable agent', pepper: 'test-pepper' });

  const drain = async (opts: { skip?: JobName[] } = {}) => {
    for (let guard = 0; guard < 500 && jobs.queue.length; guard++) {
      const job = jobs.queue.shift()!;
      if (opts.skip?.includes(job.name)) continue;
      if (job.name === 'payment.execute') await executePayment(deps, job.data.intentId!);
      else if (job.name === 'attempt.poll') {
        const next = await pollAttempt(deps, job.data.attemptId!);
        if (next !== null) await jobs.send('attempt.poll', job.data);
      } else if (job.name === 'attempt.reconcile') await reconcileAttempt(deps, job.data.attemptId!);
      else if (job.name === 'balance.refresh') await refreshBalance(deps);
      else if (job.name === 'approval.expire') await expireApprovals(deps);
    }
  };

  return {
    url: url.toString(),
    db,
    pool,
    circle,
    jobs,
    clock,
    deps,
    agentKey: apiKey,
    drain,
    close: () => pool.end(),
  };
}

export const usdc = (s: string) => toUsdc6(s);
