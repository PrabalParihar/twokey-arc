import { verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { appendAudit, createSession } from '@twokey-arc/core';
import { users } from '@twokey-arc/db';
import { apiError, CSRF_COOKIE, handle, json, SESSION_COOKIE } from '@/lib/http';
import { cfg, db, ownerReady } from '@/lib/server';

/** Email + password (argon2id), server-side session. No Google sign-in. */
export function POST(req: Request) {
  return handle(async () => {
    await ownerReady();
    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? '';
    const [u] = email ? await db().select().from(users).where(eq(users.email, email)) : [];
    const ok = !!u && !!body.password && (await verify(u.passwordHash, body.password).catch(() => false));
    const now = new Date();
    await db().transaction((tx) =>
      appendAudit(tx, cfg.orgId, {
        at: now, actorType: 'user', actorId: ok ? u!.displayName : 'unknown', verb: ok ? 'auth.login' : 'auth.failed', subjectType: 'session', subjectId: ok ? u!.id : 'none', data: {},
      }),
    );
    if (!ok) return apiError(401, 'invalid_credentials', 'email or password is wrong');
    const s = await createSession(db(), u!.id, now);
    const jar = await cookies();
    const secure = process.env.NODE_ENV === 'production';
    jar.set(SESSION_COOKIE, s.token, { httpOnly: true, secure, sameSite: 'lax', path: '/', expires: s.expiresAt });
    jar.set(CSRF_COOKIE, s.csrf, { httpOnly: false, secure, sameSite: 'lax', path: '/', expires: s.expiresAt });
    return json({ ok: true, name: u!.displayName, csrf: s.csrf });
  });
}
