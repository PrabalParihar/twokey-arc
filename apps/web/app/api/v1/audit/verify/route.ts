import { verifyAudit } from '@twokey-arc/core';
import { handle, json, requireOwner } from '@/lib/http';
import { cfg, db } from '@/lib/server';

/** Recomputes the whole chain. Read-only and public when DEMO_MODE is on, so reviewers can check it. */
export function GET(req: Request) {
  return handle(async () => {
    if (!cfg.demoMode) await requireOwner(req);
    return json(await verifyAudit(db(), cfg.orgId));
  });
}
