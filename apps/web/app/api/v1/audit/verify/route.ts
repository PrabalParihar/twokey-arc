import { verifyAudit } from '@twokey-arc/core';
import { handle, json, requireOwnerCtx } from '@/lib/http';
import { cfg, db } from '@/lib/server';

/** Recomputes the whole chain. Read-only and public when DEMO_MODE is on, so reviewers can check it. */
export function GET(req: Request) {
  return handle(async () => {
    // Public on the demo deployment (the landing shows the chain); otherwise the owner's own workspace.
    const orgId = cfg.demoMode ? cfg.orgId : (await requireOwnerCtx(req)).cfg.orgId;
    return json(await verifyAudit(db(), orgId));
  });
}
