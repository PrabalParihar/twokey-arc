import { getActiveMandate, TwokeyError } from '@twokey-arc/core';
import { handle, json, ownerOrAgent } from '@/lib/http';
import { db } from '@/lib/server';

/** Agents see limits and payee ids/names; never wallet ids. The owner sees the whole signed document. */
export function GET(req: Request) {
  return handle(async () => {
    const who = await ownerOrAgent(req);
    const m = await getActiveMandate(db(), who.cfg.orgId);
    if (!m) throw new TwokeyError('not_found', 404, 'no active mandate');
    if (who.kind === 'owner') return json(m);
    return json({
      version: m.version,
      network: m.network,
      limits: { per_tx: m.limits.per_tx, daily: m.limits.daily, hard_max_per_tx: m.limits.hard_max_per_tx },
      payees: m.payees.map((p) => ({ payee_id: p.payee_id, name: p.name })),
      expires_at: m.expires_at,
    });
  });
}
