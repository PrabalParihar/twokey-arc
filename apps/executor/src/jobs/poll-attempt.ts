import { eq } from 'drizzle-orm';
import { approvals, attempts, paymentIntents } from '@twokey-arc/db';
import { explorerTxUrl, pollAttempt, type ExecutorDeps } from '@twokey-arc/core';
import { displayUsdc } from '@twokey-arc/money';
import { editMessage } from '@twokey-arc/telegram';
import type { Logger } from 'pino';

type TelegramCfg = { token: string; chatId: string } | null;

/**
 * attempt.poll: getTransaction until a terminal state. Every 1 s for the first 15 s, then every 5 s.
 * Arc finality is sub-second, so any wait here is Circle's pipeline, not the chain.
 */
export async function handlePollAttempt(deps: ExecutorDeps, log: Logger, telegram: TelegramCfg, attemptId: string): Promise<void> {
  const next = await pollAttempt(deps, attemptId);
  if (next !== null) {
    await deps.jobs.send('attempt.poll', { attemptId }, { startAfterSeconds: next, singletonKey: `${attemptId}:${Date.now()}` });
    return;
  }
  const [att] = await deps.db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!att) return;
  log.info({ attemptId, state: att.state, txHash: att.txHash }, 'attempt.final');
  if (!telegram) return;
  // If the owner approved this one from Telegram, update that message with the result.
  const [intent] = await deps.db.select().from(paymentIntents).where(eq(paymentIntents.id, att.intentId));
  const [ap] = await deps.db.select().from(approvals).where(eq(approvals.intentId, att.intentId));
  if (!ap?.telegramMessageId || !intent) return;
  const text =
    intent.status === 'PAID' && att.txHash
      ? `<b>Paid</b> · ${displayUsdc(intent.amount)} to ${intent.payeeName ?? intent.destinationAddress}\n<a href="${explorerTxUrl(deps.cfg, att.txHash)}">tx ${att.txHash.slice(0, 10)}…</a>`
      : `<b>${intent.status}</b> · ${displayUsdc(intent.amount)} to ${intent.payeeName ?? intent.destinationAddress}`;
  await editMessage(telegram.token, telegram.chatId, ap.telegramMessageId, text).catch((e: Error) => log.warn({ err: e.message }, 'telegram edit failed'));
}
