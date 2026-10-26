import { getApproval, TwokeyError } from '@twokey-arc/core';
import { handle, json, requireOwner } from '@/lib/http';
import { cfg, db } from '@/lib/server';

/** Bound terms, the seal and its canonical bytes, so anyone can recompute it. */
export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireOwner(req);
    const { id } = await params;
    const found = await getApproval(db(), cfg.orgId, id);
    if (!found) throw new TwokeyError('not_found', 404, 'approval not found');
    const { approval, intent } = found;
    return json({
      id: approval.id,
      status: approval.status,
      seal: approval.seal,
      boundTerms: approval.boundTerms,
      boundTermsCanonical: approval.boundTermsCanonical,
      expiresAt: approval.expiresAt.toISOString(),
      voidReason: approval.voidReason,
      voidDetail: approval.voidDetail,
      paymentId: intent.id,
      failedChecks: (intent.checks as { id: string; pass: boolean; detail: string }[]).filter((c) => !c.pass),
    });
  });
}
