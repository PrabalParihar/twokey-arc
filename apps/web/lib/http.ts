import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authenticateAgent, csrfOk, getSession, TwokeyError } from '@twokey-arc/core';
import { db, ownerReady } from './server';

export const SESSION_COOKIE = 'tk_session';
export const CSRF_COOKIE = 'tk_csrf';

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export const apiError = (status: number, code: string, message: string, details?: unknown) =>
  json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);

/** Maps thrown errors to the API error shape; unexpected ones become a 500 without internals. */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    if (err instanceof TwokeyError) return apiError(err.status, err.code, err.message, err.details);
    console.error('[api] unexpected', err instanceof Error ? err.message : err);
    return apiError(500, 'internal', 'something went wrong');
  });
}

// 30 requests per minute per agent (PRD §12.4). In memory: one web instance in the spike.
const hits = new Map<string, number[]>();
function rateLimited(agentId: string, now = Date.now()): boolean {
  const recent = (hits.get(agentId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(agentId, recent);
  return recent.length > Number(process.env.AGENT_RATE_PER_MIN ?? 30);
}

export async function requireAgent(req: Request) {
  const pepper = process.env.AGENT_KEY_PEPPER;
  if (!pepper) throw new TwokeyError('misconfigured', 500, 'AGENT_KEY_PEPPER is not set');
  const agent = await authenticateAgent(db(), pepper, req.headers.get('authorization'));
  if (!agent) throw new TwokeyError('unauthorized', 401, 'a valid agent key is required');
  if (rateLimited(agent.agentId)) throw new TwokeyError('rate_limited', 429, 'too many requests; 30 per minute per agent');
  return agent;
}

/** Owner session from the cookie. Mutations also need the CSRF header to match (double submit). */
export async function requireOwner(req: Request | null, opts: { mutation?: boolean } = {}) {
  await ownerReady();
  const jar = await cookies();
  const s = await getSession(db(), jar.get(SESSION_COOKIE)?.value);
  if (!s) throw new TwokeyError('unauthorized', 401, 'owner session required');
  if (opts.mutation && !csrfOk(s.csrf, req?.headers.get('x-csrf-token'))) {
    throw new TwokeyError('csrf', 403, 'missing or wrong CSRF token');
  }
  return s.user;
}

/** Either the owner (session) or an agent (bearer); agents only see their own payments. */
export async function ownerOrAgent(req: Request): Promise<{ kind: 'owner' } | { kind: 'agent'; agentId: string }> {
  if (req.headers.get('authorization')) return { kind: 'agent', agentId: (await requireAgent(req)).agentId };
  await requireOwner(req);
  return { kind: 'owner' };
}
