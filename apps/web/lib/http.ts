import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authenticateAgent, csrfOk, getSession, isSandboxOrg, TwokeyError, type CoreConfig } from '@twokey-arc/core';
import { cfg, cfgForOrg, db, ownerReady, SANDBOX_ENABLED } from './server';

export const SESSION_COOKIE = 'tk_session';

/**
 * The caller's IP as our proxy saw it. The first X-Forwarded-For entry is whatever the client sent, so it is
 * never trusted: X-Real-IP (set by the edge) wins, else the last entry, the one the edge appended.
 */
export function clientIp(h: { get(name: string): string | null }): string {
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  return (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean).at(-1) ?? 'local';
}
export const CSRF_COOKIE = 'tk_csrf';

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export const apiError = (status: number, code: string, message: string, details?: unknown) =>
  json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);

/** Maps thrown errors to the API error shape; unexpected ones become a 500 without internals. */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    if (err instanceof TwokeyError) return apiError(err.status, err.code, err.message, err.details);
    // Log the underlying cause only: drizzle's message repeats the query and its params (hashes, ids).
    const cause = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message.split('\n')[0]) : String(err);
    console.error('[api] unexpected', cause);
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

/** `limited` applies the 30/min budget: payment requests and cancels count, status reads don't. */
export async function requireAgent(req: Request, opts: { limited?: boolean } = {}) {
  const pepper = process.env.AGENT_KEY_PEPPER;
  if (!pepper) throw new TwokeyError('misconfigured', 500, 'AGENT_KEY_PEPPER is not set');
  const agent = await authenticateAgent(db(), pepper, req.headers.get('authorization'));
  if (!agent) throw new TwokeyError('unauthorized', 401, 'a valid agent key is required');
  // A key from another org (an old testnet org, the demo) must never spend from this deployment's treasury.
  // Sandbox keys are fine: they run under their own workspace's testnet config (agentCfg).
  if (agent.orgId !== cfg.orgId && !(SANDBOX_ENABLED && isSandboxOrg(agent.orgId))) throw new TwokeyError('unauthorized', 401, 'this agent key belongs to another workspace');
  if (opts.limited && rateLimited(agent.agentId)) throw new TwokeyError('rate_limited', 429, 'too many requests; 30 per minute per agent');
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

/** The config an agent's requests run under: its own workspace's. */
export const agentCfg = (agent: { orgId: string }): CoreConfig => cfgForOrg(agent.orgId);

/** Owner session plus the config of the workspace it owns. */
export async function requireOwnerCtx(req: Request | null, opts: { mutation?: boolean } = {}) {
  const user = await requireOwner(req, opts);
  return { user, cfg: cfgForOrg(user.orgId) };
}

/** Either the owner (session) or an agent (bearer); agents only see their own payments. */
export async function ownerOrAgent(req: Request): Promise<{ kind: 'owner'; cfg: CoreConfig } | { kind: 'agent'; agentId: string; cfg: CoreConfig }> {
  if (req.headers.get('authorization')) {
    const agent = await requireAgent(req);
    return { kind: 'agent', agentId: agent.agentId, cfg: agentCfg(agent) };
  }
  return { kind: 'owner', cfg: (await requireOwnerCtx(req)).cfg };
}
