import 'server-only';
import { getBotUsername } from '@twokey-arc/telegram';

let username: Promise<string | null> | null = null;

/** The t.me link that opens the bot with a sandbox workspace's one-time code. Null when no bot is configured. */
export async function telegramLink(code: string | null): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !code) return null;
  username ??= process.env.TELEGRAM_BOT_USERNAME
    ? Promise.resolve(process.env.TELEGRAM_BOT_USERNAME)
    : getBotUsername(token).catch(() => {
        username = null;
        return null;
      });
  const u = await username;
  return u ? `https://t.me/${u}?start=${encodeURIComponent(code)}` : null;
}
