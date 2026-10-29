import { ApproveBody } from '@twokey-arc/contracts';
import { decideApproval, TwokeyError } from '@twokey-arc/core';
import { handle, json, requireOwnerCtx } from '@/lib/http';
import { deps } from '@/lib/server';

/** Owner session only, never an agent key: an agent can't approve its own request. 409 on any mismatch. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { user: owner, cfg } = await requireOwnerCtx(req, { mutation: true });
    const parsed = ApproveBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new TwokeyError('invalid_request', 400, 'body must be { seal }');
    const { id } = await params;
    const r = await decideApproval(await deps(cfg), { approvalId: id, decision: 'approve', seal: parsed.data.seal, by: owner.displayName, via: 'dashboard' });
    return json({ id: r.approval.id, status: r.approval.status, ...(r.note ? { note: r.note } : {}) });
  });
}
