import { eq } from 'drizzle-orm';
import { approvals } from '@twokey-arc/db';
import { getActiveMandate, getApproval, type ExecutorDeps } from '@twokey-arc/core';
import type { Check } from '@twokey-arc/policy';
import { sendApprovalRequest } from '@twokey-arc/telegram';
import type { Logger } from 'pino';

export interface TelegramNotify {
  token: string;
  chatId: string;
  appBaseUrl: string;
  maxApproveUsdc: string;
}

/** approval.notify: sends the approval card to the linked approver chat, if Telegram is set up and enabled in the mandate. */
export async function handleNotifyApproval(deps: ExecutorDeps, log: Logger, tg: TelegramNotify | null, approvalId: string): Promise<void> {
  if (!tg) return;
  const mandate = await getActiveMandate(deps.db, deps.cfg.orgId);
  if (!mandate?.approval.telegram) return;
  const found = await getApproval(deps.db, deps.cfg.orgId, approvalId);
  if (!found || found.approval.status !== 'PENDING' || found.approval.telegramMessageId) return;
  const { approval, intent } = found;
  const messageId = await sendApprovalRequest(tg, {
    approvalId,
    seal: approval.seal,
    payeeName: intent.payeeName,
    address: intent.destinationAddress ?? '',
    amount: intent.amount,
    memo: intent.memo,
    reasons: (intent.checks as Check[]).filter((c) => !c.pass).map((c) => c.detail),
    expiresAt: approval.expiresAt,
    networkLabel: deps.cfg.network === 'ARC-TESTNET' ? 'Arc Testnet' : 'Arc',
  });
  await deps.db.update(approvals).set({ telegramMessageId: messageId }).where(eq(approvals.id, approvalId));
  log.info({ approvalId, messageId }, 'approval.notify sent');
}
