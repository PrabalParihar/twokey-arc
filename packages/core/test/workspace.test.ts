import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { balanceSnapshots, orgs } from '@twokey-arc/db';
import {
  createAgent,
  createSandboxWorkspace,
  getActiveMandate,
  getOrg,
  isSandboxOrg,
  issueAgentKey,
  linkTelegramByCode,
  orgForTelegramChat,
  requestPayment,
  sandboxAgentId,
  setupState,
  signWizardMandate,
  telegramChatForOrg,
  validateWizardMandate,
  verifyAudit,
  type CoreConfig,
} from '../src';
import { ATTACKER, cfg, createHarness, HARBOR, OCEANIC, ORG, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h?.close());

const sandboxCfg = (orgId: string): CoreConfig => ({ ...cfg, orgId });
const SB_TREASURY = '0x5555555555555555555555555555555555555555';
const wizard = { per_tx: '0.50', daily: '1.50', hard_max_per_tx: '5.00', payees: [{ name: 'Oceanic Freight', address: OCEANIC }, { name: 'Harbor Cloud', address: HARBOR }] };

async function readyWorkspace(email: string) {
  const { orgId, userId } = await createSandboxWorkspace(h.db, { email, displayName: 'Maya', passwordHash: 'x', workspaceName: 'Northwind Ops', ip: '10.0.0.1' });
  await h.db.update(orgs).set({ status: 'READY', walletId: `w-${orgId}`, walletAddress: SB_TREASURY }).where(eq(orgs.id, orgId));
  return { orgId, userId, org: (await getOrg(h.db, orgId))! };
}

describe('sandbox workspaces', () => {
  it('opens a sandbox org with its owner, in provisioning, with its own audit chain', async () => {
    const { orgId } = await createSandboxWorkspace(h.db, { email: 'a@northwind.co', displayName: 'A', passwordHash: 'x', workspaceName: 'Northwind', ip: null });
    expect(isSandboxOrg(orgId)).toBe(true);
    const st = await setupState(h.db, orgId);
    expect(st!.org.status).toBe('PROVISIONING');
    expect(st!.done).toMatchObject({ account: true, treasury: false, mandate: false, telegram: false, key: false });
    expect(st!.next).toBe('treasury');
    expect((await verifyAudit(h.db, orgId)).ok).toBe(true);
    await expect(createSandboxWorkspace(h.db, { email: 'a@northwind.co', displayName: 'A', passwordHash: 'x', workspaceName: 'Again', ip: null })).rejects.toThrow(/already exists/);
  });

  it('refuses wizard limits above the sandbox caps, inverted limits, bad addresses and the treasury as payee', () => {
    const v = (o: Partial<typeof wizard>) => () => validateWizardMandate({ ...wizard, ...o }, SB_TREASURY);
    expect(v({ per_tx: '2.00' })).toThrow(/at most 1.00/);
    expect(v({ per_tx: '1.00', daily: '0.50' })).toThrow(/above the daily/);
    expect(v({ hard_max_per_tx: '0.10' })).toThrow(/never-above/);
    expect(v({ payees: [{ name: 'X', address: '0x123' }] })).toThrow(/40 hex/);
    expect(v({ payees: [{ name: 'Me', address: SB_TREASURY }] })).toThrow(/own treasury/);
    expect(v({ payees: [] })).toThrow(/between 1 and 5/);
    expect(validateWizardMandate(wizard, SB_TREASURY).per_tx).toBe('0.500000');
  });

  it('signs mandate v1 from the wizard on the workspace wallet, then the next version', async () => {
    const { orgId, org } = await readyWorkspace('b@northwind.co');
    const doc = await signWizardMandate(h.db, sandboxCfg(orgId), org, wizard, 'Maya');
    expect(doc.version).toBe(1);
    expect(doc.source_wallet).toEqual({ circle_wallet_id: `w-${orgId}`, address: SB_TREASURY });
    expect(doc.payees.map((p) => p.payee_id)).toEqual(['pay_oceanic_freight', 'pay_harbor_cloud']);
    expect((await signWizardMandate(h.db, sandboxCfg(orgId), org, { ...wizard, per_tx: '0.25' }, 'Maya')).version).toBe(2);
    // The deployment's own org is untouched.
    expect((await getActiveMandate(h.db, ORG))!.source_wallet.address).not.toBe(SB_TREASURY);
  });

  it('will not sign before the wallet exists', async () => {
    const { orgId } = await createSandboxWorkspace(h.db, { email: 'c@northwind.co', displayName: 'C', passwordHash: 'x', workspaceName: 'C', ip: null });
    await expect(signWizardMandate(h.db, sandboxCfg(orgId), (await getOrg(h.db, orgId))!, wizard, 'C')).rejects.toThrow(/still being set up/);
  });

  it("an agent pays under its own workspace's mandate, never the deployment's", async () => {
    const { orgId, org } = await readyWorkspace('d@northwind.co');
    await signWizardMandate(h.db, sandboxCfg(orgId), org, wizard, 'Maya');
    const agentId = sandboxAgentId(orgId);
    await createAgent(h.db, { orgId, agentId, name: 'AP', pepper: 'test-pepper' });
    await h.db.insert(balanceSnapshots).values({ id: `bal_${orgId}`, orgId, walletId: `w-${orgId}`, usdcAmount: '20', feeEstimate: '0.01', takenAt: h.clock.now(), source: 'poll' });
    const deps = { ...h.deps, cfg: sandboxCfg(orgId) };
    // 2.00 is inside the deployment's 50.00 per-payment limit but above this workspace's 0.50: it must ask.
    const { response } = await requestPayment(deps, { agentId, idempotencyKey: 'sb-inv-00001', body: { payee: { payeeId: 'pay_oceanic_freight' }, amount: '2.00' } });
    expect(response.status, JSON.stringify(response.checks)).toBe('AWAITING_APPROVAL');
    const blocked = await requestPayment(deps, { agentId, idempotencyKey: 'sb-inv-00002', body: { payee: { address: ATTACKER }, amount: '6.00' } });
    expect(blocked.response.status).toBe('BLOCKED');
  });

  it('never lets one workspace rotate (and so revoke) another workspace’s agent', async () => {
    const { orgId } = await readyWorkspace('e@northwind.co');
    await expect(issueAgentKey(h.db, { orgId, agentId: 'ap-agent', name: 'AP', pepper: 'test-pepper', by: 'Maya' })).rejects.toThrow(/another workspace/);
    const own = await issueAgentKey(h.db, { orgId, agentId: sandboxAgentId(orgId), name: 'AP', pepper: 'test-pepper', by: 'Maya' });
    expect(own.apiKey).toMatch(/^tk_agent_/);
  });

  it('links Telegram with a one-time code, and re-signs an active mandate with Telegram approvals on', async () => {
    const { orgId, org } = await readyWorkspace('f@northwind.co');
    await signWizardMandate(h.db, sandboxCfg(orgId), org, wizard, 'Maya');
    const code = org.telegramLinkCode!;
    expect(await linkTelegramByCode(h.db, sandboxCfg, code, '424242')).toMatchObject({ id: orgId });
    expect(await telegramChatForOrg(h.db, orgId)).toBe('424242');
    expect(await orgForTelegramChat(h.db, '424242')).toEqual({ orgId, by: 'Maya' });
    const m = (await getActiveMandate(h.db, orgId))!;
    expect(m.version).toBe(2);
    expect(m.approval.telegram).toBe(true);
    expect(m.limits.per_tx).toBe('0.500000');
    // The code was rotated on use.
    expect(await linkTelegramByCode(h.db, sandboxCfg, code, '999')).toBeNull();
    expect((await setupState(h.db, orgId))!.done.telegram).toBe(true);
  });
});
