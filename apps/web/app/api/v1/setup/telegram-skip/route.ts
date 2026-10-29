import { isSandboxOrg, skipTelegram, TwokeyError } from '@twokey-arc/core';
import { handle, json, requireOwnerCtx } from '@/lib/http';
import { db } from '@/lib/server';

/** Sandbox owner: approve in the console only, no Telegram. They can still link it later. */
export function POST(req: Request) {
  return handle(async () => {
    const { cfg } = await requireOwnerCtx(req, { mutation: true });
    if (!isSandboxOrg(cfg.orgId)) throw new TwokeyError('not_found', 404, 'the setup wizard is for sandbox workspaces');
    await skipTelegram(db(), cfg.orgId);
    return json({ ok: true });
  });
}
