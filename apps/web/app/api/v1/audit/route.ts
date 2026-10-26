import { listAudit, verifyAudit } from '@twokey-arc/core';
import { handle, json, requireOwner } from '@/lib/http';
import { cfg, db } from '@/lib/server';

export function GET(req: Request) {
  return handle(async () => {
    await requireOwner(req);
    const url = new URL(req.url);
    const after = Number(url.searchParams.get('after') ?? 0) || undefined;
    const entries = await listAudit(db(), cfg.orgId, { ...(after ? { after } : {}), limit: Math.min(Number(url.searchParams.get('limit') ?? 500), 5000) });
    const v = await verifyAudit(db(), cfg.orgId);
    return json({ chain_ok: v.ok, entries });
  });
}
