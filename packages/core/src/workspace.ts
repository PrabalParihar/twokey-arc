import { randomBytes } from 'node:crypto';
import { and, count, eq, gte } from 'drizzle-orm';
import { agents, orgs, paymentIntents, telegramLinks, users, type Db, type DbOrTx } from '@twokey-arc/db';
import { compareUsdc, isUsdcString, toUsdc6 } from '@twokey-arc/money';
import type { Mandate } from '@twokey-arc/policy';
import { appendAudit } from './audit';
import { newId, TwokeyError, type CoreConfig } from './base';
import { activateMandate, buildMandate, getActiveMandate } from './mandate';

/**
 * Self-serve sandbox workspaces: anyone can sign up, gets a Circle wallet on Arc Testnet, signs a mandate
 * and issues an agent key. Sandbox orgs never touch mainnet: their jobs run on the testnet executor only.
 */
export const SANDBOX_PREFIX = 'org_sb_';
export const isSandboxOrg = (orgId: string | null | undefined): orgId is string => !!orgId && orgId.startsWith(SANDBOX_PREFIX);

/** The sandbox wallet holds faucet USDC, so its limits stay cent-sized. */
export const SANDBOX_CAPS = { per_tx: '1.00', daily: '5.00', hard_max_per_tx: '10.00' } as const;

export type Org = typeof orgs.$inferSelect;

/** Sandbox agent ids are global, so they carry the workspace's suffix: `ap-3f9a1c2b7d4e`. */
export const sandboxAgentId = (orgId: string) => `ap-${orgId.slice(SANDBOX_PREFIX.length)}`;

const code = () => randomBytes(12).toString('base64url');

export async function createSandboxWorkspace(
  db: Db,
  i: { email: string; displayName: string; passwordHash: string; workspaceName: string; ip: string | null; now?: Date },
): Promise<{ orgId: string; userId: string }> {
  const now = i.now ?? new Date();
  const orgId = `${SANDBOX_PREFIX}${randomBytes(6).toString('hex')}`;
  const userId = newId('usr');
  await db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, i.email));
    if (taken) throw new TwokeyError('email_taken', 409, 'an account with this email already exists; log in instead');
    await tx.insert(orgs).values({
      id: orgId,
      name: i.workspaceName,
      kind: 'sandbox',
      status: 'PROVISIONING',
      network: 'ARC-TESTNET',
      telegramLinkCode: code(),
      signupIp: i.ip,
    });
    await tx.insert(users).values({ id: userId, email: i.email, displayName: i.displayName, passwordHash: i.passwordHash, role: 'OWNER', orgId });
    await appendAudit(tx, orgId, {
      at: now, actorType: 'user', actorId: i.displayName, verb: 'workspace.opened', subjectType: 'org', subjectId: orgId,
      data: { name: i.workspaceName, network: 'ARC-TESTNET' },
    });
  });
  return { orgId, userId };
}

export async function getOrg(db: DbOrTx, orgId: string): Promise<Org | null> {
  const [o] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  return o ?? null;
}

export async function sandboxSignupsSince(db: DbOrTx, since: Date, ip?: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(orgs)
    .where(ip ? and(gte(orgs.createdAt, since), eq(orgs.signupIp, ip)) : gte(orgs.createdAt, since));
  return r?.n ?? 0;
}

export interface WizardMandateInput {
  per_tx: string;
  daily: string;
  hard_max_per_tx: string;
  payees: { name: string; address: string }[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'payee';

/** Checks the wizard's numbers against the sandbox caps and each other; returns them as 6-decimal strings. */
export function validateWizardMandate(input: WizardMandateInput, treasury: string): WizardMandateInput {
  const bad = (msg: string): never => {
    throw new TwokeyError('invalid_mandate', 400, msg);
  };
  for (const k of ['per_tx', 'daily', 'hard_max_per_tx'] as const) {
    if (!isUsdcString(input[k]) || compareUsdc(input[k], '0') <= 0) bad(`${k} must be a USDC amount above 0`);
    if (compareUsdc(input[k], SANDBOX_CAPS[k]) > 0) bad(`${k} can be at most ${SANDBOX_CAPS[k]} in the sandbox`);
  }
  if (compareUsdc(input.per_tx, input.daily) > 0) bad('per payment cannot be above the daily limit');
  if (compareUsdc(input.per_tx, input.hard_max_per_tx) > 0) bad('per payment cannot be above the never-above limit');
  if (!Array.isArray(input.payees) || input.payees.length < 1 || input.payees.length > 5) bad('pin between 1 and 5 payees');
  const seen = new Set<string>();
  const payees = input.payees.map((p) => {
    const name = String(p.name ?? '').trim();
    const address = String(p.address ?? '').trim();
    if (name.length < 1 || name.length > 40) bad('each payee needs a name of 1 to 40 characters');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) bad(`${name}: address must be 0x followed by 40 hex characters`);
    if (address.toLowerCase() === treasury.toLowerCase()) bad(`${name}: a payee cannot be your own treasury`);
    if (seen.has(address.toLowerCase())) bad(`${name}: this address is already pinned`);
    seen.add(address.toLowerCase());
    return { name, address };
  });
  return { per_tx: toUsdc6(input.per_tx), daily: toUsdc6(input.daily), hard_max_per_tx: toUsdc6(input.hard_max_per_tx), payees };
}

/** Builds the next mandate version from the setup wizard and activates it; the owner's hold is the signature. */
export async function signWizardMandate(db: Db, cfg: CoreConfig, org: Org, input: WizardMandateInput, by: string, now = new Date()): Promise<Mandate> {
  if (org.status !== 'READY' || !org.walletId || !org.walletAddress) throw new TwokeyError('not_ready', 409, 'the workspace wallet is still being set up');
  const v = validateWizardMandate(input, org.walletAddress);
  const ids = new Set<string>();
  const payees = v.payees.map((p) => {
    let id = `pay_${slug(p.name)}`;
    for (let n = 2; ids.has(id); n++) id = `pay_${slug(p.name)}_${n}`;
    ids.add(id);
    return { payee_id: id, name: p.name, address: p.address };
  });
  const active = await getActiveMandate(db, org.id);
  const doc = buildMandate(
    {
      network: cfg.network,
      chainId: cfg.chainId,
      usdcAddress: cfg.usdcAddress,
      treasury: { walletId: org.walletId, address: org.walletAddress },
      timezone: 'UTC',
      limits: { per_tx: v.per_tx, daily: v.daily, hard_max_per_tx: v.hard_max_per_tx, min_balance_after: '0.10' },
      payees,
      validFrom: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 90 * 86_400_000),
      approval: { ttl_minutes: 15, telegram: !!(await telegramChatForOrg(db, org.id)) },
      signedBy: by,
    },
    (active?.version ?? 0) + 1,
    now,
  );
  await db.transaction((tx) => activateMandate(tx, org.id, doc, { type: 'user', id: by }, now));
  return doc;
}

export type SetupStep = 'account' | 'treasury' | 'mandate' | 'telegram' | 'key';
export interface SetupState {
  org: Org;
  done: Record<SetupStep, boolean>;
  next: SetupStep | null;
  agentId: string | null;
  firstPaymentId: string | null;
}

/** What the setup dock shows: which of the five steps are done, and the next one. */
export async function setupState(db: DbOrTx, orgId: string): Promise<SetupState | null> {
  const org = await getOrg(db, orgId);
  if (!org) return null;
  const [mandate, chat, [agent], [first]] = await Promise.all([
    getActiveMandate(db, orgId),
    telegramChatForOrg(db, orgId),
    db.select({ agentId: agents.agentId }).from(agents).where(and(eq(agents.orgId, orgId), eq(agents.status, 'ACTIVE'))).limit(1),
    db.select({ id: paymentIntents.id }).from(paymentIntents).where(eq(paymentIntents.orgId, orgId)).orderBy(paymentIntents.createdAt).limit(1),
  ]);
  const done: Record<SetupStep, boolean> = {
    account: true,
    treasury: org.status === 'READY',
    mandate: !!mandate,
    telegram: !!chat || org.telegramSkipped,
    key: !!agent,
  };
  const order: SetupStep[] = ['account', 'treasury', 'mandate', 'telegram', 'key'];
  return { org, done, next: order.find((s) => !done[s]) ?? null, agentId: agent?.agentId ?? null, firstPaymentId: first?.id ?? null };
}

export async function skipTelegram(db: Db, orgId: string): Promise<void> {
  await db.update(orgs).set({ telegramSkipped: true }).where(eq(orgs.id, orgId));
}

/** The approver chat of a sandbox workspace: the Telegram chat its owner linked, if any. */
export async function telegramChatForOrg(db: DbOrTx, orgId: string): Promise<string | null> {
  const [r] = await db
    .select({ chatId: telegramLinks.chatId })
    .from(telegramLinks)
    .innerJoin(users, eq(users.id, telegramLinks.userId))
    .where(eq(users.orgId, orgId))
    .limit(1);
  return r?.chatId ?? null;
}

/** Which workspace a Telegram chat approves for, if it was linked by a sandbox owner. */
export async function orgForTelegramChat(db: DbOrTx, chatId: string): Promise<{ orgId: string; by: string } | null> {
  const [r] = await db
    .select({ orgId: users.orgId, by: users.displayName })
    .from(telegramLinks)
    .innerJoin(users, eq(users.id, telegramLinks.userId))
    .where(eq(telegramLinks.chatId, chatId))
    .limit(1);
  return r?.orgId ? { orgId: r.orgId, by: r.by } : null;
}

/**
 * `/start <code>` from the bot: links the chat to the workspace's owner. The code is one-time (rotated on use).
 * If a mandate is already active, it is re-signed as the next version with Telegram approvals on, as the
 * channel is part of the signed document.
 */
export async function linkTelegramByCode(db: Db, cfgFor: (orgId: string) => CoreConfig, linkCode: string, chatId: string, now = new Date()): Promise<Org | null> {
  const [org] = await db.select().from(orgs).where(eq(orgs.telegramLinkCode, linkCode));
  if (!org) return null;
  const [owner] = await db.select().from(users).where(eq(users.orgId, org.id));
  if (!owner) return null;
  await db.transaction(async (tx) => {
    await tx.delete(telegramLinks).where(eq(telegramLinks.chatId, chatId));
    await tx.delete(telegramLinks).where(eq(telegramLinks.userId, owner.id));
    await tx.insert(telegramLinks).values({ id: newId('tgl'), userId: owner.id, chatId });
    await tx.update(orgs).set({ telegramLinkCode: code(), telegramSkipped: false }).where(eq(orgs.id, org.id));
    await appendAudit(tx, org.id, {
      at: now, actorType: 'user', actorId: owner.displayName, verb: 'approver.telegram_linked', subjectType: 'org', subjectId: org.id, data: {},
    });
  });
  const active = await getActiveMandate(db, org.id);
  if (active && !active.approval.telegram) {
    await signWizardMandate(
      db,
      cfgFor(org.id),
      { ...org, status: 'READY' },
      { per_tx: active.limits.per_tx, daily: active.limits.daily, hard_max_per_tx: active.limits.hard_max_per_tx, payees: active.payees.map((p) => ({ name: p.name, address: p.address })) },
      owner.displayName,
      now,
    );
  }
  return org;
}
