import { createServer } from 'node:http';
import type { Logger } from 'pino';
import type { CircleClient } from '@twokey-arc/circle';
import { bossJobs, expireApprovals, queueName, reconcileAttempt, refreshBalance, startBoss, sweep, type CirclePort, type ExecutorDeps, type JobName } from '@twokey-arc/core';
import { createDb } from '@twokey-arc/db';
import { migrateDb } from '@twokey-arc/db/migrator';
import type { loadConfig } from './config';
import { handleExecutePayment } from './jobs/execute-payment';
import { handleNotifyApproval } from './jobs/notify-approval';
import { handlePollAttempt } from './jobs/poll-attempt';
import { handleWebhook } from './jobs/process-webhook';

/**
 * Wires the job queue, safety-net timers and /healthz around a CirclePort. main.ts passes the real Circle
 * adapter; a local simulation can pass another port and exercise the same wiring without touching Arc.
 */
export async function runExecutor(conf: ReturnType<typeof loadConfig>, circle: CirclePort, log: Logger, client?: CircleClient) {
  const { db, pool } = createDb(conf.databaseUrl, 10);
  await migrateDb(db);
  const boss = await startBoss(conf.databaseUrl, 'executor', [conf.cfg.orgId]);
  const deps: ExecutorDeps = { db, cfg: conf.cfg, jobs: bossJobs(boss, conf.cfg.orgId), circle };

  type Data = Record<string, string>;
  const work = (name: JobName, fn: (data: Data) => Promise<unknown>, localConcurrency = 4) =>
    boss.work<Data>(queueName(conf.cfg.orgId, name), { batchSize: 1, localConcurrency, pollingIntervalSeconds: 0.5 }, async ([job]) => {
      try {
        await fn(job!.data);
      } catch (err) {
        log.error({ job: name, data: job!.data, err: (err as Error).message }, 'job failed');
        throw err;
      }
    });

  await work('payment.execute', (d) => handleExecutePayment(deps, log, d.intentId!));
  await work('attempt.poll', (d) => handlePollAttempt(deps, log, conf.telegram, d.attemptId!), 8);
  await work('attempt.reconcile', (d) => reconcileAttempt(deps, d.attemptId!));
  await work('balance.refresh', () => refreshBalance(deps, 'post_tx'), 1);
  await work('approval.expire', () => expireApprovals(deps), 1);
  await work('approval.notify', (d) => handleNotifyApproval(deps, log, conf.telegram, d.approvalId!));
  if (client) await work('webhook.process', (d) => handleWebhook(deps, client, log, d.notificationId!));

  // Safety nets that don't depend on a job having been sent.
  const every = (ms: number, name: string, fn: () => Promise<unknown>) =>
    setInterval(() => fn().catch((e: Error) => log.warn({ task: name, err: e.message }, 'periodic task failed')), ms);
  every(5_000, 'sweep', () => sweep(deps));
  every(30_000, 'expire', () => expireApprovals(deps));
  every(60_000, 'balance', () => refreshBalance(deps, 'poll'));
  await refreshBalance(deps, 'boot').catch((e: Error) => log.warn({ err: e.message }, 'boot balance read failed'));

  // The executor exposes nothing but liveness.
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, service: 'executor', network: conf.cfg.network }));
    } else res.writeHead(404).end();
  });
  server.listen(conf.port, () => log.info({ port: conf.port, network: conf.cfg.network }, 'executor up'));

  const shutdown = async () => {
    server.close();
    await boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
