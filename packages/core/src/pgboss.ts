import { PgBoss } from 'pg-boss';
import type { JobName, Jobs } from './base';

export const QUEUES: JobName[] = [
  'payment.execute',
  'attempt.poll',
  'attempt.reconcile',
  'balance.refresh',
  'approval.expire',
  'approval.notify',
  'webhook.process',
];

/**
 * pg-boss over the same Postgres. The executor runs it fully (migrations, maintenance, workers);
 * apps/web starts a send-only instance so it never schedules or supervises anything.
 */
export async function startBoss(connectionString: string, role: 'executor' | 'web'): Promise<PgBoss> {
  const boss = new PgBoss(
    role === 'executor'
      ? { connectionString, application_name: 'twokey-executor' }
      : { connectionString, application_name: 'twokey-web', supervise: false, schedule: false, max: 2 },
  );
  boss.on('error', (err) => console.error(`[pg-boss:${role}]`, err.message));
  await boss.start();
  for (const q of QUEUES) await boss.createQueue(q);
  return boss;
}

export function bossJobs(boss: PgBoss): Jobs {
  return {
    async send(name, data, opts) {
      await boss.send(name, data, {
        ...(opts?.startAfterSeconds ? { startAfter: opts.startAfterSeconds } : {}),
        ...(opts?.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      });
    },
  };
}
