import { driftDemo } from '@twokey-arc/core';
import { apiError, handle, json, requireOwnerCtx } from '@/lib/http';
import { deps } from '@/lib/server';

/** DEMO_MODE only: re-rounds an approved amount (+0.50 by default) to show the seal voiding it. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { cfg } = await requireOwnerCtx(req, { mutation: true });
    if (!cfg.demoMode) return apiError(404, 'not_found', 'not found');
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { delta?: string };
    return json(await driftDemo(await deps(cfg), id, body.delta ?? '0.50'));
  });
}
