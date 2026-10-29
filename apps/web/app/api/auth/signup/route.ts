import { hash } from '@node-rs/argon2';
import { cookies, headers } from 'next/headers';
import { createSandboxWorkspace, createSession, sandboxSignupsSince, TwokeyError } from '@twokey-arc/core';
import { clientIp, CSRF_COOKIE, handle, json, SESSION_COOKIE } from '@/lib/http';
import { assertSameOrigin } from '@/lib/public-demo';
import { db, SANDBOX_ENABLED } from '@/lib/server';

const PER_IP_PER_DAY = 5;
const PER_DAY = Number(process.env.SANDBOX_DAILY_SIGNUPS ?? 60);
const recent = new Map<string, number[]>();

/** A burst guard in front of the database counts: three signups per IP per hour, per instance. */
function burst(ip: string, now: number): boolean {
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  recent.set(ip, [...hits, now]);
  return hits.length >= 3;
}

/**
 * Self-serve sandbox: email + password (argon2id), a workspace on Arc Testnet, and a session. The testnet
 * executor then creates the workspace's Circle wallet and asks the faucet for test USDC.
 */
export function POST(req: Request) {
  return handle(async () => {
    if (!SANDBOX_ENABLED) throw new TwokeyError('not_found', 404, 'sign-ups are closed');
    await assertSameOrigin(req);
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; workspace?: unknown };
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const workspace = String(body.workspace ?? '').trim().replace(/\s+/g, ' ');
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(email)) throw new TwokeyError('invalid_email', 400, 'enter a valid email');
    if (password.length < 12 || password.length > 200) throw new TwokeyError('weak_password', 400, 'use at least 12 characters');
    if (workspace.length < 2 || workspace.length > 40) throw new TwokeyError('invalid_workspace', 400, 'name your workspace in 2 to 40 characters');

    const ip = clientIp(await headers());
    const now = new Date();
    const day = new Date(now.getTime() - 86_400_000);
    if (burst(ip, now.getTime()) || (await sandboxSignupsSince(db(), day, ip)) >= PER_IP_PER_DAY) {
      throw new TwokeyError('rate_limited', 429, 'too many sign-ups from this network today; try again tomorrow');
    }
    if ((await sandboxSignupsSince(db(), day)) >= PER_DAY) throw new TwokeyError('sandbox_full', 503, 'the sandbox is full for today; try again tomorrow');

    const local = email.split('@')[0]!.replace(/[._+-]+/g, ' ').trim();
    const displayName = (local.charAt(0).toUpperCase() + local.slice(1)).slice(0, 40) || 'Owner';
    const { userId, orgId } = await createSandboxWorkspace(db(), {
      email,
      displayName,
      passwordHash: await hash(password),
      workspaceName: workspace,
      ip,
      now,
    });
    const s = await createSession(db(), userId, now);
    const jar = await cookies();
    const secure = process.env.NODE_ENV === 'production';
    jar.set(SESSION_COOKIE, s.token, { httpOnly: true, secure, sameSite: 'lax', path: '/', expires: s.expiresAt });
    jar.set(CSRF_COOKIE, s.csrf, { httpOnly: false, secure, sameSite: 'lax', path: '/', expires: s.expiresAt });
    return json({ ok: true, orgId }, 201);
  });
}
