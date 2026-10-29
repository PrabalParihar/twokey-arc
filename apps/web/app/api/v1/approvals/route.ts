import { listApprovals } from '@twokey-arc/core';
import { handle, json, requireOwnerCtx } from '@/lib/http';
import { db } from '@/lib/server';

export function GET(req: Request) {
  return handle(async () => {
    const { cfg } = await requireOwnerCtx(req);
    const status = new URL(req.url).searchParams.get('status') as 'PENDING' | null;
    const rows = await listApprovals(db(), cfg.orgId, status ?? undefined);
    return json({
      approvals: rows.map(({ approval, intent }) => ({
        id: approval.id,
        status: approval.status,
        seal: approval.seal,
        expiresAt: approval.expiresAt.toISOString(),
        paymentId: intent.id,
        amount: intent.amount,
        payee: { name: intent.payeeName, address: intent.destinationAddress },
        failedChecks: (intent.checks as { id: string; pass: boolean; detail: string }[]).filter((c) => !c.pass),
      })),
    });
  });
}
