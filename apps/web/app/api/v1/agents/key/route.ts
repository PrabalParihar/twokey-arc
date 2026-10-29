import { isSandboxOrg, issueAgentKey, sandboxAgentId, TwokeyError } from '@twokey-arc/core';
import { handle, json, requireOwnerCtx } from '@/lib/http';
import { db } from '@/lib/server';

/** Owner only: issue (or rotate) the accounts-payable agent's key. Shown once; only its HMAC is stored. */
export function POST(req: Request) {
  return handle(async () => {
    const { user: owner, cfg } = await requireOwnerCtx(req, { mutation: true });
    const pepper = process.env.AGENT_KEY_PEPPER;
    if (!pepper) throw new TwokeyError('misconfigured', 500, 'AGENT_KEY_PEPPER is not set');
    // Agent ids are global: a sandbox workspace's agent carries the workspace's suffix.
    const agentId = isSandboxOrg(cfg.orgId) ? sandboxAgentId(cfg.orgId) : 'ap-agent';
    const { apiKey } = await issueAgentKey(db(), { orgId: cfg.orgId, agentId, name: 'Accounts payable agent', pepper, by: owner.displayName });
    return json({ agentId, apiKey });
  });
}
