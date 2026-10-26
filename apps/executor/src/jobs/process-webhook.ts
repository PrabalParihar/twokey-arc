import { eq } from 'drizzle-orm';
import { attempts, webhookEvents } from '@twokey-arc/db';
import { verifyCircleSignature, type CircleClient } from '@twokey-arc/circle';
import type { ExecutorDeps } from '@twokey-arc/core';
import type { Logger } from 'pino';

/**
 * webhook.process: apps/web stored the raw Circle notification without trusting it. Here, with the
 * API key, we verify X-Circle-Signature, then nudge a poll of the attempt it names. The poll re-reads
 * state from Circle, so a duplicate or out-of-order delivery can't move anything backwards.
 */
export async function handleWebhook(deps: ExecutorDeps, client: CircleClient, log: Logger, notificationId: string): Promise<void> {
  const [ev] = await deps.db.select().from(webhookEvents).where(eq(webhookEvents.notificationId, notificationId));
  if (!ev || ev.processedAt) return;
  const ok = !!ev.signature && !!ev.keyId && (await verifyCircleSignature(client, { rawBody: ev.rawBody, signature: ev.signature, keyId: ev.keyId }));
  await deps.db.update(webhookEvents).set({ signatureOk: ok, processedAt: new Date() }).where(eq(webhookEvents.notificationId, notificationId));
  if (!ok) {
    log.warn({ notificationId }, 'webhook signature invalid; ignored');
    return;
  }
  const txId = (ev.payload as { notification?: { id?: string } }).notification?.id;
  if (!txId) return;
  const [att] = await deps.db.select({ id: attempts.id }).from(attempts).where(eq(attempts.circleTransactionId, txId));
  if (att) await deps.jobs.send('attempt.poll', { attemptId: att.id }, { singletonKey: `wh:${notificationId}` });
}
