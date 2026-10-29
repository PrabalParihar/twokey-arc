import { cancelPayment } from '@twokey-arc/core';
import { agentCfg, handle, json, requireAgent, requireOwnerCtx } from '@/lib/http';
import { deps } from '@/lib/server';

/** Lowers risk: allowed only before anything reaches Circle. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    if (req.headers.get('authorization')) {
      const agent = await requireAgent(req, { limited: true });
      return json(await cancelPayment(await deps(agentCfg(agent)), { intentId: id, actor: { type: 'agent', id: agent.agentId }, agentId: agent.agentId }));
    }
    const { user: owner, cfg } = await requireOwnerCtx(req, { mutation: true });
    return json(await cancelPayment(await deps(cfg), { intentId: id, actor: { type: 'user', id: owner.displayName } }));
  });
}
