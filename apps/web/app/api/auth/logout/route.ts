import { cookies } from 'next/headers';
import { revokeSession } from '@twokey-arc/core';
import { CSRF_COOKIE, handle, json, requireOwner, SESSION_COOKIE } from '@/lib/http';
import { db } from '@/lib/server';

export function POST(req: Request) {
  return handle(async () => {
    await requireOwner(req, { mutation: true });
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) await revokeSession(db(), token);
    jar.delete(SESSION_COOKIE);
    jar.delete(CSRF_COOKIE);
    return json({ ok: true });
  });
}
