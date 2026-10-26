// Telegram approvals setup. 1) Create a bot with @BotFather and put TELEGRAM_BOT_TOKEN in .env.
// 2) Send your bot any message, then: pnpm telegram:setup chat     (writes TELEGRAM_APPROVER_CHAT_ID)
// 3) Once the web app is deployed:      pnpm telegram:setup webhook (registers APP_BASE_URL/api/telegram/webhook)
import { randomBytes } from 'node:crypto';
import { setWebhook } from '@twokey-arc/telegram';
import { upsertEnv } from './lib/env-file';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
const step = process.argv[2];

if (step === 'chat') {
  const res = (await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json()) as {
    result: { message?: { chat: { id: number; first_name?: string } } }[];
  };
  const chat = res.result.map((u) => u.message?.chat).filter(Boolean).at(-1);
  if (!chat) throw new Error('no messages yet: send your bot a message first (and no webhook may be set yet)');
  upsertEnv('TELEGRAM_APPROVER_CHAT_ID', String(chat.id));
  console.log(`approver chat ${chat.id} (${chat.first_name ?? 'unknown'}) written to .env`);
} else if (step === 'webhook') {
  const base = process.env.APP_BASE_URL;
  if (!base?.startsWith('https://')) throw new Error('APP_BASE_URL must be the public https URL of the web app');
  let secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    secret = randomBytes(24).toString('base64url');
    upsertEnv('TELEGRAM_WEBHOOK_SECRET', secret);
  }
  await setWebhook(token, `${base.replace(/\/$/, '')}/api/telegram/webhook`, secret);
  console.log('webhook set; copy TELEGRAM_WEBHOOK_SECRET from .env to the Railway web service');
} else {
  console.log('usage: pnpm telegram:setup chat | webhook');
}
