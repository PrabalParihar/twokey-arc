import { displayUsdc, parseUsdc } from '@twokey-arc/money';
import { sealGroups } from '@twokey-arc/seal';

/** Bot API over fetch. The token never leaves this module's request URLs and is never logged. */
async function call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

export interface ApprovalCard {
  approvalId: string;
  seal: string;
  payeeName: string | null;
  address: string;
  amount: string;
  memo: string | null;
  reasons: string[];
  expiresAt: Date;
  networkLabel: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ist = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Callback data carries the approval id and the first 12 hex of the seal; the server re-checks the full seal. */
export const callbackData = (verb: 'a' | 'r', approvalId: string, seal: string) => `${verb}:${approvalId}:${seal.slice(7, 19)}`;

export function parseCallback(data: string): { decision: 'approve' | 'reject'; approvalId: string; sealPrefix: string } | null {
  const m = /^([ar]):(apr_[0-9a-f]{32}):([0-9a-f]{12})$/.exec(data);
  if (!m) return null;
  return { decision: m[1] === 'a' ? 'approve' : 'reject', approvalId: m[2]!, sealPrefix: m[3]! };
}

export function approvalText(c: ApprovalCard): string {
  return [
    '<b>Twokey · needs you</b>',
    `Pay ${esc(c.payeeName ?? 'a new payee')} <b>${displayUsdc(c.amount)}</b> on ${c.networkLabel}`,
    `To <code>${short(c.address)}</code>${c.memo ? ` · memo ${esc(c.memo)}` : ''}`,
    `Why: ${esc(c.reasons.join(', '))}`,
    `Sealed <code>${sealGroups(c.seal)}</code> · expires ${ist(c.expiresAt)} IST`,
  ].join('\n');
}

export async function sendApprovalRequest(
  i: { token: string; chatId: string; appBaseUrl: string; maxApproveUsdc: string },
  c: ApprovalCard,
): Promise<number> {
  const open = { text: 'Open', url: `${i.appBaseUrl.replace(/\/$/, '')}/approvals/${c.approvalId}` };
  const canApproveHere = parseUsdc(c.amount) <= parseUsdc(i.maxApproveUsdc);
  const keyboard = canApproveHere
    ? [[{ text: 'Approve', callback_data: callbackData('a', c.approvalId, c.seal) }, { text: 'Reject', callback_data: callbackData('r', c.approvalId, c.seal) }, open]]
    : [[{ ...open, text: 'Open dashboard' }]];
  const msg = await call<{ message_id: number }>(i.token, 'sendMessage', {
    chat_id: i.chatId,
    text: approvalText(c),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
  return msg.message_id;
}

export const editMessage = (token: string, chatId: string, messageId: number, html: string) =>
  call(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });

export const answerCallback = (token: string, callbackQueryId: string, text: string) =>
  call(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text });

export const setWebhook = (token: string, url: string, secret: string) =>
  call(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['callback_query'] });
