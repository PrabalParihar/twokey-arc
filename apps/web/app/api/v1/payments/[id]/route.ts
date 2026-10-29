import { getPayment, TwokeyError } from '@twokey-arc/core';
import { handle, json, ownerOrAgent } from '@/lib/http';
import { db } from '@/lib/server';

export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const who = await ownerOrAgent(req);
    const { id } = await params;
    const p = await getPayment(db(), who.cfg, id, who.kind === 'agent' ? who.agentId : undefined);
    if (!p) throw new TwokeyError('not_found', 404, 'payment not found');
    return json(p);
  });
}
