import { issueAgentKey, TwokeyError } from '@twokey-arc/core';
import { handle, json, requireOwner } from '@/lib/http';
import { cfg, db } from '@/lib/server';

/** Owner only: issue (or rotate) the accounts-payable agent's key. Shown once; only its HMAC is stored. */
export function POST(req: Request) {
  return handle(async () => {
    const owner = await requireOwner(req, { mutation: true });
    const pepper = process.env.AGENT_KEY_PEPPER;
    if (!pepper) throw new TwokeyError('misconfigured', 500, 'AGENT_KEY_PEPPER is not set');
    const { apiKey } = await issueAgentKey(db(), { orgId: cfg.orgId, agentId: 'ap-agent', name: 'Accounts payable agent', pepper, by: owner.displayName });
    return json({ agentId: 'ap-agent', apiKey });
  });
}
