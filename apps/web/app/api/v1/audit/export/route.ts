import { listAudit } from '@twokey-arc/core';
import { handle, requireOwnerCtx } from '@/lib/http';
import { db } from '@/lib/server';

/** JSONL for auditors: one entry per line, hashes included, so the chain can be re-verified offline. */
export function GET(req: Request) {
  return handle(async () => {
    const { cfg } = await requireOwnerCtx(req);
    const entries = await listAudit(db(), cfg.orgId);
    return new Response(entries.map((e) => JSON.stringify(e)).join('\n') + '\n', {
      headers: { 'content-type': 'application/x-ndjson', 'content-disposition': 'attachment; filename="twokey-audit.jsonl"' },
    });
  });
}
