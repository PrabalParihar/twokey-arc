import { timingSafeEqual } from 'node:crypto';
import { decideApproval, linkTelegramByCode, orgForTelegramChat, TwokeyError } from '@twokey-arc/core';
import { answerCallback, editMessage, parseCallback, sendMessage } from '@twokey-arc/telegram';
import { json } from '@/lib/http';
import { cfgForOrg, db, deps, OWNER_NAME, SANDBOX_ENABLED } from '@/lib/server';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/**
 * Approve / Reject buttons from Telegram, and `/start <code>` links for sandbox workspaces. The secret header
 * is checked; a chat decides only for the workspace it is linked to: the deployment's own approver chat
 * (TELEGRAM_APPROVER_CHAT_ID) for its org, a linked sandbox chat for that sandbox. Callback data carries the
 * approval id and 12 hex of the seal, re-checked against the full seal.
 */
export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const ownerChat = process.env.TELEGRAM_APPROVER_CHAT_ID;
  if (!token || !secret || (!ownerChat && !SANDBOX_ENABLED)) return json({ ok: false }, 404);
  if (!same(req.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) return json({ ok: false }, 401);

  const update = (await req.json().catch(() => ({}))) as {
    message?: { chat: { id: number; type?: string }; text?: string };
    callback_query?: { id: string; data?: string; from?: { id: number }; message?: { message_id: number; chat: { id: number }; text?: string } };
  };

  const start = update.message?.text?.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})$/);
  if (update.message && start && SANDBOX_ENABLED) {
    const chat = String(update.message.chat.id);
    if (chat === ownerChat) {
      await sendMessage(token, chat, 'This chat already approves for this deployment and cannot be linked to a sandbox.').catch(() => undefined);
      return json({ ok: true });
    }
    const org = await linkTelegramByCode(db(), cfgForOrg, start[1]!, chat).catch(() => null);
    const reply = org
      ? `Linked to <b>${esc(org.name)}</b>. Payments outside your mandate will ask you here, with the seal to check.`
      : 'That link has expired. Open Twokey and press "Link Telegram" again.';
    await sendMessage(token, chat, reply).catch(() => undefined);
    return json({ ok: true });
  }

  const cb = update.callback_query;
  if (!cb?.data || !cb.message) return json({ ok: true });
  const chat = String(cb.message.chat.id);
  const linked = chat === ownerChat ? null : SANDBOX_ENABLED ? await orgForTelegramChat(db(), chat) : null;
  if (chat !== ownerChat && !linked) {
    await answerCallback(token, cb.id, 'This chat cannot approve payments.');
    return json({ ok: true });
  }
  const parsed = parseCallback(cb.data);
  if (!parsed) return json({ ok: true });

  let result: string;
  try {
    // decideApproval looks the approval up inside this org only, so a chat can never decide another workspace's.
    await decideApproval(await deps(linked ? cfgForOrg(linked.orgId) : undefined), {
      approvalId: parsed.approvalId,
      decision: parsed.decision,
      sealPrefix: parsed.sealPrefix,
      ...(parsed.decision === 'reject' ? { reason: 'Rejected from Telegram' } : {}),
      by: linked ? linked.by : OWNER_NAME,
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
