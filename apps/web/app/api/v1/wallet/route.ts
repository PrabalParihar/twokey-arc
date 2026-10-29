import { getActiveMandate, latestBalance } from '@twokey-arc/core';
import { handle, json, requireOwnerCtx } from '@/lib/http';
import { db } from '@/lib/server';

/** Treasury address and its one USDC balance (the executor snapshots it from Circle; web has no Circle access). */
export function GET(req: Request) {
  return handle(async () => {
    const { cfg } = await requireOwnerCtx(req);
    const m = await getActiveMandate(db(), cfg.orgId);
    if (!m) return json({ treasury: null });
    const bal = await latestBalance(db(), m.source_wallet.circle_wallet_id);
    return json({
      network: cfg.network,
      chainId: cfg.chainId,
      treasury: m.source_wallet.address,
      usdc: bal?.usdc ?? null,
      feeEstimate: bal?.fee ?? null,
      takenAt: bal?.takenAt.toISOString() ?? null,
    });
  });
}
