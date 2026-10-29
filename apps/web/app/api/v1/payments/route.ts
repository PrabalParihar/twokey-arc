import { listPayments, requestPayment, toResponse } from '@twokey-arc/core';
import { agentCfg, handle, json, requireAgent, requireOwnerCtx } from '@/lib/http';
import { db, deps } from '@/lib/server';

/** Agent: request a payment. Twokey answers executed, pending_approval or blocked. */
export function POST(req: Request) {
  return handle(async () => {
    const agent = await requireAgent(req, { limited: true });
    const claimed = req.headers.get('x-twokey-agent');
    if (claimed && claimed !== agent.agentId) return json({ error: { code: 'agent_mismatch', message: 'key belongs to another agent' } }, 403);
    const body = await req.json().catch(() => null);
    const { response, replayed } = await requestPayment(await deps(agentCfg(agent)), {
      agentId: agent.agentId,
      idempotencyKey: req.headers.get('idempotency-key'),
      body,
    });
    return json(response, replayed ? 200 : 202);
  });
}

/** Owner: the timeline. */
export function GET(req: Request) {
  return handle(async () => {
    const { cfg } = await requireOwnerCtx(req);
    const url = new URL(req.url);
    const rows = await listPayments(db(), cfg.orgId, {
      ...(url.searchParams.get('status') ? { status: url.searchParams.get('status')! } : {}),
      limit: Math.min(Number(url.searchParams.get('limit') ?? 50), 200),
    });
    return json({ payments: rows.map((r) => toResponse(cfg, r.intent, r.approval, r.attempt)) });
  });
}
