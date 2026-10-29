import { getOrg, isSandboxOrg, signWizardMandate, TwokeyError, type WizardMandateInput } from '@twokey-arc/core';
import { handle, json, requireOwnerCtx } from '@/lib/http';
import { db } from '@/lib/server';

/** Sandbox owner: sign the next mandate version from the setup wizard. The hold on the page is the signature. */
export function POST(req: Request) {
  return handle(async () => {
    const { user, cfg } = await requireOwnerCtx(req, { mutation: true });
    if (!isSandboxOrg(cfg.orgId)) throw new TwokeyError('not_found', 404, 'the setup wizard is for sandbox workspaces');
    const org = await getOrg(db(), cfg.orgId);
    if (!org) throw new TwokeyError('not_found', 404, 'workspace not found');
    const body = (await req.json().catch(() => ({}))) as WizardMandateInput;
    const doc = await signWizardMandate(db(), cfg, org, body, user.displayName);
    return json({ version: doc.version, seal: doc.signature, limits: doc.limits, payees: doc.payees.map((p) => ({ payee_id: p.payee_id, name: p.name })) }, 201);
  });
}
