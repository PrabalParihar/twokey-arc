import { createServer } from 'node:http';
import type { Logger } from 'pino';
import type { PgBoss } from 'pg-boss';
import type { CircleClient } from '@twokey-arc/circle';
import {
  bossJobs,
  expireApprovals,
  isSandboxOrg,
  QUEUES,
  queueName,
  reconcileAttempt,
  refreshBalance,
  startBoss,
  sweep,
  telegramChatForOrg,
  type CirclePort,
  type CoreConfig,
  type ExecutorDeps,
  type JobName,
} from '@twokey-arc/core';
import { createDb, type Db } from '@twokey-arc/db';
import { migrateDb } from '@twokey-arc/db/migrator';
import type { loadConfig } from './config';
import { handleExecutePayment } from './jobs/execute-payment';
import { handleNotifyApproval, type TelegramNotify } from './jobs/notify-approval';
import { handlePollAttempt } from './jobs/poll-attempt';
import { handleWebhook } from './jobs/process-webhook';
import { startSandboxHost } from './sandbox';

type Conf = ReturnType<typeof loadConfig>;

/**
 * Wires the job queue, safety-net timers and /healthz around a CirclePort. main.ts passes the real Circle
 * adapter; a local simulation can pass another port and exercise the same wiring without touching Arc.
 * One process serves its own org (TWOKEY_ORG_ID) and, on testnet with SANDBOX_HOST=true, every sandbox workspace.
 */
export async function runExecutor(conf: Conf, circle: CirclePort, log: Logger, client?: CircleClient) {
  const { db, pool } = createDb(conf.databaseUrl, 10);
  await migrateDb(db);
  const boss = await startBoss(conf.databaseUrl, 'executor', [conf.cfg.orgId]);
  const timers: NodeJS.Timeout[] = [];

  await serveOrg({ db, boss, circle, log, conf, client, timers }, conf.cfg);
  if (conf.sandboxHost) {
    if (!client || conf.cfg.network !== 'ARC-TESTNET') throw new Error('SANDBOX_HOST runs on Arc Testnet with a real Circle client only');
    await startSandboxHost({ db, client, log, conf, timers, serve: (cfg) => serveOrg({ db, boss, circle, log, conf, timers }, cfg) });
  }

  // The executor exposes nothing but liveness.
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, service: 'executor', network: conf.cfg.network }));
    } else res.writeHead(404).end();
  });
  server.listen(conf.port, () => log.info({ port: conf.port, network: conf.cfg.network, sandboxHost: conf.sandboxHost }, 'executor up'));

  const shutdown = async () => {
    server.close();
    timers.forEach(clearInterval);
    await boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

interface Ctx {
  db: Db;
  boss: PgBoss;
  circle: CirclePort;
  log: Logger;
  conf: Conf;
  client?: CircleClient;
  timers: NodeJS.Timeout[];
}

/** Workers and safety-net timers for one org. Sandbox orgs poll less often: they are many and cent-sized. */
async function serveOrg(ctx: Ctx, cfg: CoreConfig) {
  const { db, boss, circle, log, conf } = ctx;
  const sandbox = isSandboxOrg(cfg.orgId);
  for (const q of QUEUES) await boss.createQueue(queueName(cfg.orgId, q));
  const deps: ExecutorDeps = { db, cfg, jobs: bossJobs(boss, cfg.orgId), circle };
  const olog = log.child({ org: cfg.orgId });

  // The deployment's org approves in its own chat; a sandbox in the chat its owner linked, if any.
  const tg = async (): Promise<TelegramNotify | null> => {
    if (!sandbox) return conf.telegram;
    if (!conf.telegramBot) return null;
    const chatId = await telegramChatForOrg(db, cfg.orgId);
    return chatId ? { ...conf.telegramBot, chatId } : null;
  };

  type Data = Record<string, string>;
  const work = (name: JobName, fn: (data: Data) => Promise<unknown>, localConcurrency = 4) =>
    boss.work<Data>(queueName(cfg.orgId, name), { batchSize: 1, localConcurrency, pollingIntervalSeconds: sandbox ? 1 : 0.5 }, async ([job]) => {
      try {
        await fn(job!.data);
      } catch (err) {
        olog.error({ job: name, data: job!.data, err: (err as Error).message }, 'job failed');
        throw err;
      }
    });

  await work('payment.execute', (d) => handleExecutePayment(deps, olog, d.intentId!));
  await work('attempt.poll', async (d) => handlePollAttempt(deps, olog, await tg(), d.attemptId!), 8);
  await work('attempt.reconcile', (d) => reconcileAttempt(deps, d.attemptId!));
  await work('balance.refresh', () => refreshBalance(deps, 'post_tx'), 1);
  await work('approval.expire', () => expireApprovals(deps), 1);
  await work('approval.notify', async (d) => handleNotifyApproval(deps, olog, await tg(), d.approvalId!));
  if (ctx.client) await work('webhook.process', (d) => handleWebhook(deps, ctx.client!, olog, d.notificationId!));

  // Safety nets that don't depend on a job having been sent.
  const every = (ms: number, name: string, fn: () => Promise<unknown>) =>
    ctx.timers.push(setInterval(() => fn().catch((e: Error) => olog.warn({ task: name, err: e.message }, 'periodic task failed')), ms));
  every(sandbox ? 10_000 : 5_000, 'sweep', () => sweep(deps));
  every(30_000, 'expire', () => expireApprovals(deps));
  every(sandbox ? 120_000 : 60_000, 'balance', () => refreshBalance(deps, 'poll'));
  await refreshBalance(deps, 'boot').catch((e: Error) => olog.warn({ err: e.message }, 'boot balance read failed'));
}
