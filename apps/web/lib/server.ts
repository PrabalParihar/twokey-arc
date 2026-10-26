import 'server-only';
import { eq } from 'drizzle-orm';
import { bossJobs, startBoss, type CoreConfig, type CoreDeps, type Jobs } from '@twokey-arc/core';
import { createDb, users, type Db } from '@twokey-arc/db';
import { assertNoCircleSecrets } from './boot';
import { ARC_EXPLORER } from './explorer';

assertNoCircleSecrets();

export const cfg: CoreConfig = {
  orgId: process.env.TWOKEY_ORG_ID ?? 'org_twokey',
  network: process.env.CIRCLE_BLOCKCHAIN ?? 'ARC-TESTNET',
  chainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
  usdcAddress: process.env.USDC_TOKEN_ADDRESS ?? '0x3600000000000000000000000000000000000000',
  explorerUrl: ARC_EXPLORER,
  defaultFeeEstimateUsdc: process.env.DEFAULT_FEE_ESTIMATE_USDC ?? '0.010000',
  approvalGraceSeconds: Number(process.env.APPROVAL_GRACE_SECONDS ?? 0),
  demoMode: process.env.DEMO_MODE === 'true',
};

export const OWNER_NAME = process.env.OWNER_NAME ?? 'Prabal';

type State = { db: Db; jobs: Promise<Jobs>; ownerReady: Promise<void> };
const g = globalThis as unknown as { __twokey?: State };

function init(): State {
  const url = process.env.DATABASE_URL_WEB ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db } = createDb(url, 10);
  const jobs = startBoss(url, 'web').then(bossJobs);
  jobs.catch((e: Error) => console.error('pg-boss (web) failed to start:', e.message));
  return { db, jobs, ownerReady: ensureOwner(db) };
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

export async function deps(): Promise<CoreDeps> {
  const s = state();
  return { db: s.db, cfg, jobs: await s.jobs };
}
