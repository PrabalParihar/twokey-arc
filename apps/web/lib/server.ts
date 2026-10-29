import 'server-only';
import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { bossJobs, isSandboxOrg, QUEUES, queueName, startBoss, TwokeyError, type CoreConfig, type CoreDeps } from '@twokey-arc/core';
import { createDb, users, type Db } from '@twokey-arc/db';
import { assertNoCircleSecrets } from './boot';
import { ARC_EXPLORER, TESTNET_EXPLORER } from './explorer';

assertNoCircleSecrets();

/** The owner's treasury network. Mainnet is two deliberate settings, as in the executor. */
export const MAINNET = process.env.TWOKEY_NETWORK === 'mainnet' && process.env.TWOKEY_ALLOW_MAINNET === 'i-understand-real-usdc';

export const cfg: CoreConfig = {
  orgId: process.env.TWOKEY_ORG_ID ?? 'org_twokey',
  network: MAINNET ? 'ARC' : 'ARC-TESTNET',
  chainId: MAINNET ? 5042 : 5042002,
  usdcAddress: process.env.USDC_TOKEN_ADDRESS ?? '0x3600000000000000000000000000000000000000',
  explorerUrl: ARC_EXPLORER,
  defaultFeeEstimateUsdc: process.env.DEFAULT_FEE_ESTIMATE_USDC ?? '0.010000',
  approvalGraceSeconds: Number(process.env.APPROVAL_GRACE_SECONDS ?? 0),
  demoMode: process.env.DEMO_MODE === 'true',
};

export const OWNER_NAME = process.env.OWNER_NAME ?? 'Prabal';

/**
 * The public demo runs in its own org, with its own Circle wallet and executor, and always on testnet:
 * anonymous visitors never spend real USDC. Off unless PUBLIC_DEMO=true.
 */
export const DEMO_ENABLED = process.env.PUBLIC_DEMO === 'true';
export const demoCfg: CoreConfig = {
  ...cfg,
  orgId: process.env.DEMO_ORG_ID ?? 'org_demo',
  network: 'ARC-TESTNET',
  chainId: 5042002,
  explorerUrl: TESTNET_EXPLORER,
  demoMode: true,
  approvalGraceSeconds: 6,
};

/**
 * Self-serve sandbox workspaces (SANDBOX_SIGNUPS=true): each signup gets its own org on Arc Testnet, served by
 * the testnet executor. Like the public demo, a sandbox never runs on mainnet, whatever this deployment runs.
 */
export const SANDBOX_ENABLED = process.env.SANDBOX_SIGNUPS === 'true';
export const sandboxCfg = (orgId: string): CoreConfig => ({ ...demoCfg, orgId, demoMode: false, approvalGraceSeconds: 0 });

/** The config a request runs under: the deployment's own org, the public demo, or one sandbox workspace. */
export function cfgForOrg(orgId: string | null | undefined): CoreConfig {
  if (!orgId || orgId === cfg.orgId) return cfg;
  if (orgId === demoCfg.orgId) return demoCfg;
  if (isSandboxOrg(orgId)) return sandboxCfg(orgId);
  throw new TwokeyError('unknown_org', 403, 'unknown workspace');
}

type State = { db: Db; boss: Promise<PgBoss>; ownerReady: Promise<void>; queues: Set<string> };
const g = globalThis as unknown as { __twokey?: State };

function init(): State {
  const url = process.env.DATABASE_URL_WEB ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db } = createDb(url, 10);
  const boss = startBoss(url, 'web', DEMO_ENABLED ? [cfg.orgId, demoCfg.orgId] : [cfg.orgId]);
  boss.catch((e: Error) => console.error('pg-boss (web) failed to start:', e.message));
  return { db, boss, ownerReady: ensureOwner(db), queues: new Set(DEMO_ENABLED ? [cfg.orgId, demoCfg.orgId] : [cfg.orgId]) };
}

/** Upserts the single owner from OWNER_EMAIL + OWNER_PASSWORD_HASH (argon2id), so a fresh deploy can log in. */
async function ensureOwner(db: Db): Promise<void> {
  const email = process.env.OWNER_EMAIL?.toLowerCase();
  const hash = process.env.OWNER_PASSWORD_HASH;
  if (!email || !hash) return;
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) {
    await db.insert(users).values({ id: 'usr_owner', email, displayName: OWNER_NAME, passwordHash: hash, role: 'OWNER' });
  } else if (u.passwordHash !== hash || u.displayName !== OWNER_NAME) {
    await db.update(users).set({ passwordHash: hash, displayName: OWNER_NAME }).where(eq(users.id, u.id));
  }
}

function state(): State {
  g.__twokey ??= init();
  return g.__twokey;
}

export const db = (): Db => state().db;
export const ownerReady = () => state().ownerReady;

export async function deps(config: CoreConfig = cfg): Promise<CoreDeps> {
  const s = state();
  const boss = await s.boss;
  // A sandbox org's queues are created on first use; pg-boss refuses to send to a queue that does not exist.
  if (!s.queues.has(config.orgId)) {
    for (const q of QUEUES) await boss.createQueue(queueName(config.orgId, q));
    s.queues.add(config.orgId);
  }
  return { db: s.db, cfg: config, jobs: bossJobs(boss, config.orgId) };
}
