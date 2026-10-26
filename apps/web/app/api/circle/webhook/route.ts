import { webhookEvents } from '@twokey-arc/db';
import { apiError, handle, json } from '@/lib/http';
import { db, deps } from '@/lib/server';

/**
 * Circle v2 notifications (at-least-once, unordered). Web stores the raw body and headers and returns 200
 * fast; it can't verify X-Circle-Signature itself because fetching Circle's public key needs the API key,
 * which only the executor holds. The executor verifies, then acts. Duplicates dedupe on notificationId.
 */
export function POST(req: Request) {
  return handle(async () => {
    const raw = await req.text();
    let payload: { notificationId?: string; notificationType?: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return apiError(400, 'invalid_json', 'body is not JSON');
    }
    // Circle's endpoint test sends a HEAD/POST without a notificationId; accept it.
    if (!payload.notificationId) return json({ ok: true });
    const inserted = await db()
      .insert(webhookEvents)
      .values({
        notificationId: payload.notificationId,
        notificationType: payload.notificationType ?? 'unknown',
        payload,
        rawBody: raw,
        signature: req.headers.get('x-circle-signature'),
        keyId: req.headers.get('x-circle-key-id'),
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.notificationId });
    if (inserted.length) await (await deps()).jobs.send('webhook.process', { notificationId: payload.notificationId });
    return json({ ok: true, duplicate: inserted.length === 0 });
  });
}

export const HEAD = () => new Response(null, { status: 200 });
