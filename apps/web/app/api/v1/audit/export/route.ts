import { listAudit } from '@twokey-arc/core';
import { handle, requireOwner } from '@/lib/http';
import { cfg, db } from '@/lib/server';

/** JSONL for auditors: one entry per line, hashes included, so the chain can be re-verified offline. */
export function GET(req: Request) {
  return handle(async () => {
    await requireOwner(req);
    const entries = await listAudit(db(), cfg.orgId);
    return new Response(entries.map((e) => JSON.stringify(e)).join('\n') + '\n', {
      headers: { 'content-type': 'application/x-ndjson', 'content-disposition': 'attachment; filename="twokey-audit.jsonl"' },
    });
  });
}
