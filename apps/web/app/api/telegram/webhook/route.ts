import { timingSafeEqual } from 'node:crypto';
import { decideApproval, TwokeyError } from '@twokey-arc/core';
import { answerCallback, editMessage, parseCallback } from '@twokey-arc/telegram';
import { json } from '@/lib/http';
import { deps, OWNER_NAME } from '@/lib/server';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Approve / Reject buttons from Telegram. Only the linked approver chat can decide; the secret header is
 * checked; callback data carries the approval id and 12 hex of the seal, re-checked against the full seal.
 */
export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const chat = process.env.TELEGRAM_APPROVER_CHAT_ID;
  if (!token || !secret || !chat) return json({ ok: false }, 404);
  if (!same(req.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) return json({ ok: false }, 401);

  const update = (await req.json().catch(() => ({}))) as {
    callback_query?: { id: string; data?: string; from?: { id: number }; message?: { message_id: number; chat: { id: number }; text?: string } };
  };
  const cb = update.callback_query;
  if (!cb?.data || !cb.message) return json({ ok: true });
  if (String(cb.message.chat.id) !== chat) {
    await answerCallback(token, cb.id, 'This chat cannot approve payments.');
    return json({ ok: true });
  }
  const parsed = parseCallback(cb.data);
  if (!parsed) return json({ ok: true });

  let result: string;
  try {
    await decideApproval(await deps(), {
      approvalId: parsed.approvalId,
      decision: parsed.decision,
      sealPrefix: parsed.sealPrefix,
      ...(parsed.decision === 'reject' ? { reason: 'Rejected from Telegram' } : {}),
      by: OWNER_NAME,
      via: 'telegram',
    });
    result = parsed.decision === 'approve' ? 'Approved · sending on Arc…' : 'Rejected · nothing was sent';
  } catch (err) {
    result = err instanceof TwokeyError ? `Not done: ${err.message}` : 'Not done: something went wrong';
  }
  await answerCallback(token, cb.id, result).catch(() => undefined);
  await editMessage(token, chat, cb.message.message_id, `${(cb.message.text ?? '').split('\n').slice(0, 2).join('\n')}\n<b>${result}</b>`).catch(() => undefined);
  return json({ ok: true });
}
