import { RejectBody } from '@twokey-arc/contracts';
import { decideApproval, TwokeyError } from '@twokey-arc/core';
import { handle, json, requireOwner } from '@/lib/http';
import { deps } from '@/lib/server';

export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const owner = await requireOwner(req, { mutation: true });
    const parsed = RejectBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new TwokeyError('reason_required', 400, 'a reason is required to reject');
    const { id } = await params;
    const r = await decideApproval(await deps(), { approvalId: id, decision: 'reject', reason: parsed.data.reason, by: owner.displayName, via: 'dashboard' });
    return json({ id: r.approval.id, status: r.approval.status });
  });
}
